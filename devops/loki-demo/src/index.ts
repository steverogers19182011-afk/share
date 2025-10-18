import * as k8s from "@pulumi/kubernetes";
import {Provider as K8sProvider} from "@pulumi/kubernetes";
import {CustomResource} from "@pulumi/kubernetes/apiextensions";
import {Namespace, Service} from "@pulumi/kubernetes/core/v1";
import {Release} from "@pulumi/kubernetes/helm/v3";
import {PriorityClass} from "@pulumi/kubernetes/scheduling/v1";
import {Resource} from "@pulumi/pulumi";
import * as kind from "@starton/pulumi-kind";

const DEFAULT_PASSWORD = "12345678";
const LOAD_BALANCER_IP = "172.18.0.4";

const config = {
    ingress: false,
};

const promtail = (
    lokiUrl: string,
    dependsOn: Resource[],
    k8sProvider: K8sProvider,
    namespace: Namespace,
) => {
    const promtailPriorityClass = new PriorityClass(
        "promtail",
        {
            metadata: {
                name: "promtail",
            },
            value: 800000000,
        },
        {
            dependsOn,
            provider: k8sProvider,
        },
    );

    new Release(
        "promtail",
        {
            name: "promtail",
            namespace: namespace.metadata.name,
            repositoryOpts: {
                repo: "https://grafana.github.io/helm-charts",
            },
            chart: "promtail",
            version: "6.15.3",
            atomic: true,
            values: {
                priorityClassName: promtailPriorityClass.metadata.name,
                tolerations: [
                    {
                        operator: "Exists",
                    },
                ],
                configmap: {
                    enabled: true,
                },
                config: {
                    clients: [
                        {
                            url: lokiUrl
                        },
                    ],
                    snippets: {
                        extraScrapeConfigs: `
# Add an additional scrape config for syslog
- job_name: journal
  journal:
    path: /var/log/journal
    max_age: 12h
    labels:
      job: systemd-journal
  relabel_configs:
    - source_labels:
        - __journal__hostname
      target_label: hostname

    # example label values: kubelet.service, containerd.service
    - source_labels:
        - __journal__systemd_unit
      target_label: unit

    # example label values: debug, notice, info, warning, error
    - source_labels:
        - __journal_priority_keyword
      target_label: level`,
                    },
                },
                extraVolumes: [
                    {
                        name: "journal",
                        hostPath: {
                            path: "/var/log/journal",
                        },
                    },
                    {
                        name: "machine-id",
                        hostPath: {
                            path: "/etc/machine-id",
                        },
                    },
                ],
                extraVolumeMounts: [
                    {
                        name: "journal",
                        mountPath: "/var/log/journal",
                        readOnly: true,
                    },
                    {
                        name: "machine-id",
                        mountPath: "/etc/machine-id",
                        readOnly: true,
                    },
                ],
            },
        },
        {
            dependsOn,
            provider: k8sProvider,
        },
    );
};

const loki = (
    dependsOn: Resource[],
    k8sProvider: K8sProvider,
    namespace: Namespace,
) => {
    // const storageClass = new StorageClass(
    //     "loki",
    //     {
    //         metadata: {
    //             name: "loki",
    //             annotations: {
    //                 "resize.topolvm.io/197enabled": "true",
    //             },
    //         },
    //         provisioner: "ebs.csi.aws.com",
    //         reclaimPolicy: "Delete",
    //         volumeBindingMode: "WaitForFirstConsumer",
    //         allowVolumeExpansion: true,
    //         parameters: {
    //             "csi.storage.k8s.io/fstype": "ext4",
    //             type: "gp3",
    //             iopsPerGB: "10",
    //             allowAutoIOPSPerGBIncrease: "true",
    //             blockExpress: "false",
    //             encrypted: "true",
    //             tagSpecification_1: `Name={{ .PVCNamespace }}--{{ .PVCName }}`,
    //         },
    //     },
    //     {
    //         dependsOn,
    //         provider: k8sProvider,
    //     },
    // );

    const loki = new Release(
        "loki",
        {
            name: "loki",
            namespace: namespace.metadata.name,
            repositoryOpts: {
                repo: "https://grafana.github.io/helm-charts",
            },
            chart: "loki",
            version: "5.41.6",
            timeout: 120,
            atomic: true,
            values: {
                loki: {
                    config: JSON.stringify({
                        auth_enabled: false,
                        common: {
                            compactor_address: "loki",
                            path_prefix: "/var/loki",
                            replication_factor: 1,
                            ring: {
                                instance_addr: "127.0.0.1",
                                kvstore: {
                                    store: "memberlist",
                                },
                            },
                            storage: {
                                filesystem: {
                                    chunks_directory: "/var/loki/chunks",
                                    rules_directory: "/var/loki/rules",
                                },
                            },
                        },
                        compactor: {
                            working_directory: "/var/loki/compactor",
                            shared_store: "filesystem",
                            compaction_interval: "10m",
                            retention_enabled: true,
                            retention_delete_delay: "2h",
                            retention_delete_worker_count: 150,
                        },
                        frontend: {
                            max_outstanding_per_tenant: 4096,
                        },
                        limits_config: {
                            retention_period: "3d",
                            ingestion_rate_mb: 100,
                            ingestion_burst_size_mb: 100,
                            per_stream_rate_limit: "100MB",
                            per_stream_rate_limit_burst: "100MB",
                            enforce_metric_name: false,
                            max_cache_freshness_per_query: "10m",
                            reject_old_samples: true,
                            reject_old_samples_max_age: "168h",
                            split_queries_by_interval: "15m",
                        },
                        memberlist: {
                            join_members: ["loki-memberlist"],
                        },
                        query_range: {
                            parallelise_shardable_queries: true,
                            align_queries_with_step: true,
                        },
                        query_scheduler: {
                            max_outstanding_requests_per_tenant: 4096,
                        },
                        ruler: {
                            storage: {
                                local: {
                                    directory: "/var/loki/rules",
                                },
                                type: "local",
                            },
                        },
                        runtime_config: {
                            file: "/etc/loki/runtime-config/runtime-config.yaml",
                        },
                        schema_config: {
                            configs: [
                                {
                                    from: "2020-01-01",
                                    index: {
                                        period: "24h",
                                        prefix: "loki_index_",
                                    },
                                    object_store: "filesystem",
                                    schema: "v11",
                                    store: "boltdb-shipper",
                                },
                            ],
                        },
                        server: {
                            grpc_listen_port: 9095,
                            http_listen_port: 3100,
                        },
                        storage_config: {
                            filesystem: {
                                directory: "/var/loki/chunks",
                            },
                            boltdb_shipper: {
                                cache_ttl: "24h",
                                shared_store: "filesystem",
                            },
                        },
                        table_manager: {
                            retention_deletes_enabled: false,
                            retention_period: "60d",
                        },
                    }),
                },
                serviceAccount: {
                    create: false,
                },
                memberlist: {
                    service: {
                        publishNotReadyAddresses: true,
                    },
                },
                monitoring: {
                    selfMonitoring: {
                        enabled: false,
                        grafanaAgent: {
                            installOperator: false,
                        },
                    },
                    lokiCanary: {
                        enabled: false,
                    },
                },
                gateway: {
                    enabled: false,
                },
                singleBinary: {
                    replicas: 1,
                    persistence: {
                        enabled: true,
                        // storageClass: "loki",
                        // storageClass: storageClass.metadata.name,
                        size: "1Gi",
                        mountPath: "/var/loki",
                    },
                    nodeSelector: {
                        // TODO: change later
                        "kubernetes.io/arch": "amd64",
                    },
                },
                test: {
                    enabled: false,
                },
            },
        },
        {
            dependsOn,
            provider: k8sProvider,
        },
    );
};

const grafana = (
    dependsOn: Resource[],
    k8sProvider: K8sProvider,
    namespace: Namespace,
) => {
    const grafanaOperator = new Release(
        `grafana-operator`,
        {
            name: "grafana-operator",
            namespace: namespace.metadata.name,
            chart: "oci://ghcr.io/grafana/helm-charts/grafana-operator",
            version: "v5.10.0",
            atomic: true,
            values: {},
        },
        {
            provider: k8sProvider,
        },
    );

    new CustomResource(
        `grafana`,
        {
            apiVersion: "grafana.integreatly.org/v1beta1",
            kind: "Grafana",
            metadata: {
                name: "grafana",
                namespace: namespace.metadata.name,
                labels: {
                    dashboards: "grafana",
                },
            },
            spec: {
                config: {
                    security: {
                        disable_initial_admin_creation: "false",
                        admin_user: "admin",
                        admin_password: DEFAULT_PASSWORD,
                    },
                    users: {
                        allow_sign_up: "false",
                        viewers_can_edit: "true",
                    },
                    log: {
                        level: "warn",
                    },
                },
                deployment: {
                    spec: {
                        template: {
                            spec: {
                                nodeSelector: {
                                    "kubernetes.io/arch": "amd64",
                                },
                                containers: [
                                    {
                                        name: "grafana",
                                    },
                                ],
                                securityContext: {
                                    fsGroup: 10001,
                                    fsGroupChangePolicy: "OnRootMismatch",
                                },
                            },
                        },
                    },
                },
            },
        },
        {
            provider: k8sProvider,
            dependsOn: [grafanaOperator],
            ignoreChanges: [
                "spec.deployment.spec.template.spec.containers[*]",
            ],
        },
    );
};

async function main() {
    const name = "test";
    const kindProvider = new kind.Provider("kind");

    const cluster = new kind.Cluster(
        name,
        {
            name,
            nodeImage: "kindest/node:v1.30.2",
            waitForReady: true,
            kindConfig: {
                kind: "Cluster",
                apiVersion: "kind.x-k8s.io/v1alpha4",
                nodes: [
                    {
                        role: "control-plane",
                    },
                ],
            },
        },
        {provider: kindProvider},
    );
    const k8sProvider = new k8s.Provider(
        "cluster",
        {
            kubeconfig: cluster.kubeconfig,
        },
        {dependsOn: [cluster]},
    );

    const infraNs = new Namespace(
        `infra`,
        {
            metadata: {
                name: "infra",
            },
        },
        {
            provider: k8sProvider,
        },
    );

    if (config.ingress) {
        const metallb = new Release(
            "metallb",
            {
                name: "metallb",
                namespace: "infra",
                repositoryOpts: {
                    repo: "https://metallb.github.io/metallb",
                },
                chart: "metallb",
                version: "0.15.2",
                atomic: true,
            },
            {
                provider: k8sProvider,
            },
        );

        const ipAddressPool = new CustomResource(
            "ip-address-pool",
            {
                apiVersion: "metallb.io/v1beta1",
                kind: "IPAddressPool",
                metadata: {
                    name: "main",
                    namespace: "infra",
                },
                spec: {
                    addresses: ["172.18.0.1-172.18.0.10"],
                },
            },
            {provider: k8sProvider, dependsOn: [metallb]},
        );

        new Service(
            "grafana-external",
            {
                metadata: {
                    name: "grafana-external",
                    namespace: infraNs.metadata.name,
                    annotations: {
                        "metallb.universe.tf/address-pool": "main",
                    },
                },
                spec: {
                    type: "LoadBalancer",
                    loadBalancerIP: LOAD_BALANCER_IP,
                    selector: {
                        app: "grafana",
                    },
                    ports: [
                        {
                            name: "http",
                            port: 8080,
                            targetPort: 3000,
                        },
                    ],
                },
            },
            {provider: k8sProvider, dependsOn: [ipAddressPool]},
        );
    }

    // loki([], k8sProvider, infraNs);
    // grafana([], k8sProvider, infraNs);
    promtail(`http://172.18.0.1:3100/loki/api/v1/push`, [], k8sProvider, infraNs);
}

main()
    .then(() => {
    })
    .catch((error) => {
        console.log(error);
    });
