/**
 * LODESTAR — the Evidence Graph (V1, milestone M-V), in one import.
 *
 *   objects (records) → add-only store → derived index → resolution → named queries
 *
 * See GRAPH-SPEC.md for the format, V1-DESIGN-REVIEW.md §12 for the architecture,
 * docs/M-V-ENGINEERING.md for this milestone's design and its attack record.
 */

export {
  GRAPH_DIRNAME,
  GRAPH_FORMAT,
  GRAPH_FORMAT_VERSION,
  initGraph,
  openGraph,
  findGraphRoot,
  addRecordValue,
  addRecordFile,
  addLinkValue,
  addFromProject,
  listRecordFiles,
  listLinkFiles,
  readLinks,
  verifyGraph,
  readRecord,
  readLink,
  walkLinks,
  type AddResult,
  type Graph,
  type GraphVerifyResult,
  type ObjectReport,
} from './store.js'
export {
  buildEvidence,
  evidenceOfRecord,
  pathKeyOf,
  resolveIdentities,
  type EvidenceInput,
  type IdentityCandidate,
  type IdentityEvidence,
  type RepoGroup,
  type Resolution,
} from './identity.js'
export { normalizeRemoteUrl } from './normalize.js'
export {
  configureShare,
  readShare,
  syncGraph,
  type ConfigureShareOptions,
  type ShareConfig,
  type SyncOptions,
  type SyncReport,
} from './sync.js'
export {
  reindex,
  indexFreshness,
  ensureFreshIndex,
  queryRepos,
  queryRepoHistory,
  queryFileHistory,
  queryDivergences,
  queryTimeline,
  queryCoverage,
  queryLinks,
  resolveRepoDisplayName,
  reportJson,
  type Freshness,
  type ReindexResult,
  type ReposReport,
  type RepoHistoryReport,
  type FileHistoryReport,
  type DivergencesReport,
  type TimelineReport,
  type CoverageReport,
  type LinksReport,
  type LinkView,
} from './graph-index.js'
