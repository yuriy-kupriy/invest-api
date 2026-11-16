import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

// ── 1. Config validation comes FIRST, before any call to the cluster. Every value
// here lives in the vault (HW #11) and arrives through scripts/with-secrets.sh
// (or `export` for the grader). No `?? "changeme"`: a missing one must stop the
// deployment and name itself, not deploy a default secret.
const VAULT_VARS = [
  'DB_URL',
  'DB_PASSWORD',
  'JWT_KID',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'REFRESH_TOKEN_PEPPER',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
] as const;
type VaultVar = (typeof VAULT_VARS)[number];

const missing = VAULT_VARS.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(
    `missing vault variable(s): ${missing.join(', ')} — run through scripts/with-secrets.sh ` +
      `or export them (README ## Grading)`,
  );
}
const vault = Object.fromEntries(VAULT_VARS.map((name) => [name, process.env[name] as string])) as Record<
  VaultVar,
  string
>;

const cfg = new pulumi.Config();
const image = 'invest-api:hw28'; // what npm run image:build tags and cluster:up loads
const replicas = 3;
const nodePort = 30080; // also in k8s/kind-config.yaml and the demos
const rev = cfg.require('rev');
const profile = cfg.require('profile');
if (profile !== 'safe' && profile !== 'broken') {
  throw new Error(`config profile must be "safe" or "broken", got "${profile}"`);
}
const safe = profile === 'safe';

// The vault DB_URL names the role and the database; the address is the cluster's.
const dbUrl = new URL(vault.DB_URL);
const dbUser = decodeURIComponent(dbUrl.username);
const dbName = decodeURIComponent(dbUrl.pathname.replace(/^\//, ''));
if (!dbUser || !dbName) {
  throw new Error('DB_URL must name a role and a database: postgres://<role>@<host>/<database>');
}

const ns = new k8s.core.v1.Namespace('invest', { metadata: { name: 'invest' } });
const namespace = ns.metadata.name;
const labels = { app: 'invest-api' };
const pgLabels = { app: 'postgres' };

// ── 2. The runtime secret. `data` with base64, not `stringData`: stringData is
// write-only, the API never returns it, and every `up` would show a diff.
// base64 is NOT encryption — in kind it sits in etcd in clear (README).
const secretValues: Record<string, string> = {
  ...vault,
  DB_URL: `postgres://${encodeURIComponent(dbUser)}@postgres:5432/${encodeURIComponent(dbName)}`,
};
const secret = new k8s.core.v1.Secret('invest-api-secrets', {
  metadata: { name: 'invest-api-secrets', namespace },
  type: 'Opaque',
  data: pulumi.secret(
    Object.fromEntries(Object.entries(secretValues).map(([k, v]) => [k, Buffer.from(v).toString('base64')])),
  ),
});
const secretName = secret.metadata.name;

// ── 3. Postgres for the app (single replica, ephemeral: this is a demo cluster).
const pg = new k8s.apps.v1.Deployment('postgres', {
  metadata: { name: 'postgres', namespace },
  spec: {
    replicas: 1,
    selector: { matchLabels: pgLabels },
    template: {
      metadata: { labels: pgLabels },
      spec: {
        containers: [
          {
            name: 'postgres',
            image: 'postgres:16-alpine',
            ports: [{ containerPort: 5432 }],
            env: [
              { name: 'POSTGRES_USER', value: dbUser },
              { name: 'POSTGRES_DB', value: dbName },
              { name: 'POSTGRES_PASSWORD', valueFrom: { secretKeyRef: { name: secretName, key: 'DB_PASSWORD' } } },
            ],
            readinessProbe: {
              exec: { command: ['pg_isready', '-U', dbUser, '-d', dbName, '-h', '127.0.0.1'] },
              periodSeconds: 2,
            },
            resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { memory: '256Mi' } },
            volumeMounts: [{ name: 'data', mountPath: '/var/lib/postgresql/data' }],
          },
        ],
        volumes: [{ name: 'data', emptyDir: {} }],
      },
    },
  },
});
const pgService = new k8s.core.v1.Service('postgres', {
  metadata: { name: 'postgres', namespace },
  spec: { selector: pgLabels, ports: [{ port: 5432, targetPort: 5432 }] },
});

// Shared by the migration Job and the app: every vault value by reference, and
// the DB password ALSO as a file, because the app re-reads it from disk on each
// new connection (rotation without restart, HW #2).
const secretEnvFrom = [{ secretRef: { name: secretName } }];
const passwordVolume = {
  name: 'db-password',
  secret: { secretName, items: [{ key: 'DB_PASSWORD', path: 'db_password' }] },
};
const passwordMount = { name: 'db-password', mountPath: '/var/run/invest', readOnly: true };
const passwordFileEnv = { name: 'DB_PASSWORD_FILE', value: '/var/run/invest/db_password' };
const securityContext = {
  // A number, not "nonroot": kubelet cannot resolve names, and runAsNonRoot
  // with a named user is CreateContainerConfigError.
  runAsUser: 65532,
  runAsGroup: 65532,
  runAsNonRoot: true,
  allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: true,
  capabilities: { drop: ['ALL'] },
};

// ── 4. Migrations once, before the app — not in every pod's init: three pods
// starting together would race on the migrations table.
const migrate = new k8s.batch.v1.Job(
  'invest-api-migrate',
  {
    metadata: { namespace },
    spec: {
      backoffLimit: 6,
      template: {
        spec: {
          restartPolicy: 'OnFailure',
          containers: [
            {
              name: 'migrate',
              image,
              imagePullPolicy: 'IfNotPresent',
              command: ['/nodejs/bin/node', 'node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/data-source.js'],
              envFrom: secretEnvFrom,
              env: [passwordFileEnv],
              securityContext,
              volumeMounts: [passwordMount],
            },
          ],
          volumes: [passwordVolume],
        },
      },
    },
  },
  { dependsOn: [pg, pgService] },
);

// ── 5. The app.
const DRAIN_MS = 5000;
const deployment = new k8s.apps.v1.Deployment(
  'invest-api',
  {
    metadata: { name: 'invest-api', namespace, labels },
    spec: {
      // Declared here AND managed by the HPA below: in a cluster with
      // metrics-server that is a field-ownership conflict (README ## Kubernetes).
      replicas,
      selector: { matchLabels: labels },
      strategy: {
        type: 'RollingUpdate',
        // safe: never take an old pod away before a new one says "ready".
        rollingUpdate: { maxUnavailable: safe ? 0 : 1, maxSurge: safe ? 1 : 0 },
      },
      template: {
        metadata: { labels },
        spec: {
          // Must exceed DRAIN_MS, or SIGKILL lands mid-drain (exit 137).
          terminationGracePeriodSeconds: safe ? 15 : 1,
          containers: [
            {
              name: 'api',
              image,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ name: 'http', containerPort: 3000 }],
              envFrom: secretEnvFrom,
              env: [
                passwordFileEnv,
                { name: 'NODE_ENV', value: 'production' },
                { name: 'PORT', value: '3000' },
                // No NBU calls from a demo cluster; the cache loads what the table has.
                { name: 'FX_SYNC_ON_START', value: '0' },
                { name: 'STARTUP_DELAY_MS', value: '4000' },
                { name: 'DRAIN_MS', value: String(safe ? DRAIN_MS : 0) },
                // Changing it changes the pod template, which is what rolls the pods.
                { name: 'REV', value: rev },
              ],
              // "Can I get traffic?" — red during warmup and from the first moment of SIGTERM.
              readinessProbe: safe
                ? { httpGet: { path: '/health/ready', port: 'http' }, periodSeconds: 1, failureThreshold: 1 }
                : undefined,
              // "Should I be killed?" — a different path that never goes red while draining.
              livenessProbe: {
                httpGet: { path: '/health', port: 'http' },
                initialDelaySeconds: 10,
                periodSeconds: 10,
                failureThreshold: 3,
              },
              resources: { requests: { cpu: '100m', memory: '160Mi' }, limits: { memory: '512Mi' } },
              securityContext,
              volumeMounts: [passwordMount],
            },
          ],
          volumes: [passwordVolume],
        },
      },
    },
  },
  { dependsOn: [migrate] },
);

const service = new k8s.core.v1.Service('invest-api', {
  metadata: { name: 'invest-api', namespace },
  spec: { type: 'NodePort', selector: labels, ports: [{ port: 80, targetPort: 'http', nodePort }] },
});

// ── 6. Room for maintenance: one pod may be evicted, the second must wait.
// minAvailable == replicas would block every node drain.
const pdb = new k8s.policy.v1.PodDisruptionBudget('invest-api', {
  metadata: { name: 'invest-api', namespace },
  spec: { minAvailable: replicas - 1, selector: { matchLabels: labels } },
});

// ── 7. Declared, not active: kind has no metrics-server, so TARGETS shows <unknown>.
const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler('invest-api', {
  metadata: { name: 'invest-api', namespace },
  spec: {
    scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deployment.metadata.name },
    minReplicas: 2,
    maxReplicas: 5,
    metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }],
  },
});

export const namespaceName = namespace;
export const deploymentName = deployment.metadata.name;
export const serviceUrl = pulumi.interpolate`http://127.0.0.1:${service.spec.ports[0].nodePort}`;
export const pdbName = pdb.metadata.name;
export const hpaName = hpa.metadata.name;
