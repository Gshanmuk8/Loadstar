/**
 * LODESTAR — the Evidence Record layer, in one import.
 *
 * The canonical artifact between the ledger and every presentation surface:
 *
 *   ledger → buildRecord() → EvidenceRecord → reportFromRecord() → renderers
 *                                │
 *                                └→ serializeRecord() → .record.json / embedded in HTML
 *                                        │
 *                                        └→ verifier/lodestar-verify.mjs (standalone)
 *
 * See docs/RECORD-SPEC.md for the wire format, D-059 for why this layer exists.
 */

export {
  RECORD_FORMAT,
  RECORD_FORMAT_VERSION,
  type EvidenceRecord,
  type Integrity,
  type IntegrityStatus,
  type RecordEvidence,
  type RecordGenerator,
  type RecordIdentity,
  type RecordObservations,
  type RecordSubject,
} from './types.js'
export { buildRecord, computeRecordId } from './build.js'
export { checkRecord, type CheckResult } from './check.js'
export { serializeRecord, recordScriptTag, RECORD_HTML_MARKER_ID } from './serialize.js'
export {
  LINK_FORMAT,
  LINK_FORMAT_VERSION,
  KNOWN_LINK_TYPES,
  computeLinkId,
  serializeLink,
  checkLink,
  makeLink,
  activeLinks,
  deriveIdentityDirectives,
  addressKind,
  repoAddress,
  repoSignalOf,
  linkTargetOf,
  type Link,
  type LinkCheckResult,
  type IdentityDirective,
} from './link.js'
