import { useParams } from "react-router-dom";
import type { ConfigurationChange, ConfigurationRequest } from "../../../../src/runtime-configuration";
import { requestConfigurationChange } from "../../api/configuration";
import { ConfigurationDetails } from "../../components/ConfigurationDetails";
import { Panel, PanelBody, PanelHeader } from "../../components/Panel";
import { ErrorBanner, SkeletonRows } from "../../components/States";
import { SearchConfig } from "./SearchConfig";
import { RuntimeConfigEditor } from "./RuntimeConfigEditor";
import { LiveRuntimeAccounting, RuntimeBudgetDetails } from "./RuntimeBudgetMetrics";
import { useRuntimeConfiguration } from "./useRuntimeConfiguration";
import styles from "./Config.module.css";

function describeStatus(status: ConfigurationRequest["status"], change: ConfigurationChange): string {
  switch (status) {
    case "pending":
      return change.type === "addAgents"
        ? "Queued. New workers wait until the original workers finish startup."
        : "Queued. Waiting for the runtime to apply this change.";
    case "applying":
      return "Applying. The runtime is updating the configuration and worker processes.";
    case "applied":
      return change.type === "addAgents"
        ? "Added to the roster. New workers may still be starting."
        : "Change applied.";
    case "rejected":
      return "Change rejected. See the error below.";
  }
}

function describeChange(change: ConfigurationChange): string {
  switch (change.type) {
    case "addAgents":
      return `Add ${change.count} workers`;
    case "removeAgent":
      return `Remove ${change.name}`;
    case "retireAgent":
      return `Replace ${change.name} after handoff`;
    case "raiseBudget":
      return "Update budget ceilings";
  }
}

export function ConfigPage() {
  const { id = "" } = useParams();
  const state = useRuntimeConfiguration(id);
  const view = state.data;
  const latestRequest = view?.requests.find((request) => request.run === view.run);
  const request = async (change: ConfigurationChange) => {
    if (!view) throw new Error("Configuration is still loading.");
    try {
      const updated = await requestConfigurationChange(id, view.run, view.revision, change);
      state.update((current) => (current && current.revision > updated.revision ? current : updated));
    } finally {
      // A failed response does not prove a write failed. Refresh status without replaying the request.
      state.reload();
    }
  };
  return (
    <LiveRuntimeAccounting swarmId={id} initial={view?.budget}>
      <Panel aria-label="Swarm configuration" className={styles.page}>
        <PanelHeader title="Swarm configuration" />
        <PanelBody className={styles.details}>
          <SearchConfig swarmId={id} />
          {state.error && <ErrorBanner>{`Could not load configuration: ${state.error.message}`}</ErrorBanner>}
          {!view ? (
            !state.error && <SkeletonRows />
          ) : (
            <>
              <div className={styles.overview}>
                <div>
                  <h3>Manage this swarm</h3>
                  <p>Adjust workers and budgets without changing project settings.</p>
                </div>
                <span className={styles.badge}>
                  Run {view.run} · Revision {view.revision}
                </span>
              </div>
              {latestRequest && (
                <p role="status">
                  {describeChange(latestRequest.change)}: {describeStatus(latestRequest.status, latestRequest.change)}
                </p>
              )}
              <RuntimeConfigEditor
                workers={view.configuration?.effective.workers.map((model) => ({ name: model.name, model })) ?? []}
                budget={view.configuration?.effective.budget ?? null}
                accounting={view.budget}
                maxAgents={view.configuration?.effective.limits.maxAgents}
                disabled={
                  !view.configuration ||
                  view.requests.some(
                    (request) =>
                      request.run === view.run && (request.status === "pending" || request.status === "applying"),
                  )
                }
                onAdd={(count) => request({ type: "addAgents", count })}
                onRemove={(name) => request({ type: "removeAgent", name })}
                onRaiseBudget={(patch) => request({ type: "raiseBudget", ...patch })}
              />
              <section className={styles.card} aria-labelledby="config-history-title">
                <div className={styles.sectionHeader}>
                  <h3 id="config-history-title">Recent change requests</h3>
                  <span className={styles.badge}>{view.requests.length}</span>
                </div>
                {view.requests.length === 0 ? (
                  <p className={styles.empty}>No runtime changes requested.</p>
                ) : (
                  <ul className={styles.requests} aria-label="Configuration change requests">
                    {view.requests.map((request) => (
                      <li key={request.id}>
                        <div className={styles.requestTitle}>
                          <strong>
                            #{request.id} {describeChange(request.change)}:{" "}
                            <span className={styles.badge}>{request.status}</span>
                          </strong>
                        </div>
                        <p>
                          Run {request.run} · requested by {request.requestedBy}
                        </p>
                        {request.error && <ErrorBanner>{request.error}</ErrorBanner>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <details className={styles.disclosure}>
                <summary>
                  Run configuration <span>Models, launch settings and timing</span>
                </summary>
                <div className={styles.diagnostics}>
                  <ConfigurationDetails configuration={view.configuration} />
                  <h3>Changes requiring a new run</h3>
                  <p>
                    Models, thinking levels, credentials, launch extensions, task criteria and RPC frame limits require
                    a new run.
                  </p>
                </div>
              </details>
              <details className={styles.disclosure}>
                <summary>
                  Budget accounting <span>Usage, limits and shutdown policy</span>
                </summary>
                <div className={styles.diagnostics}>
                  <RuntimeBudgetDetails fallback={view.budget} />
                </div>
              </details>
            </>
          )}
        </PanelBody>
      </Panel>
    </LiveRuntimeAccounting>
  );
}
