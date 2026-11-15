import { makeSeed } from '../data/seed.js'
import { validateSimulationPlan, validateSimulationResult } from '../simulation/client.js'

/** Recover interrupted HTTP work explicitly; never replace a real run with demo output. */
export function restorePipelineState(saved) {
  if (!saved || !Array.isArray(saved.issues) || !saved.demo || !saved.sourceStatus || !saved.ingest) return makeSeed()
  const issues = saved.issues.map(issue => {
    if (issue.playtest?.source === 'hexlab' && !issue.run &&
      (!validateSimulationPlan(issue.playtest.request, issue.playtest.configSnapshot).valid ||
        !validateSimulationResult(issue.playtest.result, issue.playtest.request).valid)) {
      return { ...issue, status: 'error', error: { title: 'Saved simulation result is incomplete',
        message: 'Return to Development and run a new comparison before verifying this change.' } }
    }
    if (issue.run?.kind !== 'simulation') return issue
    return { ...issue, run: null, status: 'error', error: {
      title: 'Simulation interrupted',
      message: 'This page closed before the simulation result was received. Retry the comparison or return to Development.',
      run: issue.run,
    } }
  })
  // Preserve existing browser work while making the supported example discoverable.
  if (!issues.some(issue => issue.id === 'iss-hexlab-yasuo')) {
    issues.unshift(makeSeed().issues.find(issue => issue.id === 'iss-hexlab-yasuo'))
  }
  return { ...saved, issues }
}
