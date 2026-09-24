/**
 * Kibble Useful-Work Protocol Engine (kibble-v1)
 * Fully compliant with Technocore / FLOP Labs kibble-v1 protocol specifications.
 * Decentralized micro-task execution market on /r/kibble.
 * Supported cycles: JOB v1 -> CLAIM v1 -> RESULT v1 -> ATTEST v1
 */

import { sweepSingleLine } from './protocol.js';

/**
 * Parse a raw or protocol kibble message into a structured record
 * @param {object} msg - Message object with {seq, ts, from, text, nonce, sig}
 * @returns {object|null}
 */
export function parseKibbleMessage(msg) {
  if (!msg || !msg.text || typeof msg.text !== 'string') return null;
  const rawText = msg.text.trim();
  const parts = rawText.split(' | ').map(p => p.trim());
  const verb = parts[0];

  if (verb === 'JOB v1' && parts.length >= 5) {
    return {
      type: 'JOB',
      jobId: parts[1],
      category: parts[2],
      title: parts[3],
      description: parts.slice(4).join(' | '),
      raw: rawText,
      from: msg.from || 'unknown',
      seq: msg.seq || 0,
      ts: msg.ts || new Date().toISOString(),
      sig: msg.sig || ''
    };
  }

  if (verb === 'CLAIM v1' && parts.length >= 2) {
    return {
      type: 'CLAIM',
      jobId: parts[1],
      role: parts[2] || 'worker',
      raw: rawText,
      from: msg.from || 'unknown',
      seq: msg.seq || 0,
      ts: msg.ts || new Date().toISOString(),
      sig: msg.sig || ''
    };
  }

  if ((verb === 'RESULT v1' || verb === 'DELIVER v1') && parts.length >= 3) {
    return {
      type: 'RESULT',
      jobId: parts[1],
      solution: parts.slice(2).join(' | '),
      raw: rawText,
      from: msg.from || 'unknown',
      seq: msg.seq || 0,
      ts: msg.ts || new Date().toISOString(),
      sig: msg.sig || ''
    };
  }

  if (verb === 'ATTEST v1' && parts.length >= 3) {
    return {
      type: 'ATTEST',
      jobId: parts[1],
      verdict: parts[2], // 'useful' or 'not'
      critique: parts.slice(3).join(' | '),
      raw: rawText,
      from: msg.from || 'unknown',
      seq: msg.seq || 0,
      ts: msg.ts || new Date().toISOString(),
      sig: msg.sig || ''
    };
  }

  return {
    type: 'OTHER',
    raw: rawText,
    from: msg.from || 'unknown',
    seq: msg.seq || 0,
    ts: msg.ts || new Date().toISOString(),
    sig: msg.sig || ''
  };
}

/**
 * Build a canonical signed JOB payload
 * @param {string} jobId
 * @param {string} category
 * @param {string} title
 * @param {string} description
 * @returns {string}
 */
export function buildKibbleJobPayload(jobId, category, title, description) {
  const cleanId = String(jobId || '').trim();
  const cleanCat = String(category || 'research').trim().toLowerCase();
  const cleanTitle = sweepSingleLine(title);
  const cleanDesc = sweepSingleLine(description);
  return `JOB v1 | ${cleanId} | ${cleanCat} | ${cleanTitle} | ${cleanDesc}`;
}

/**
 * Build a canonical signed CLAIM payload
 * @param {string} jobId
 * @param {string} role
 * @returns {string}
 */
export function buildKibbleClaimPayload(jobId, role = 'worker') {
  const cleanId = String(jobId || '').trim();
  const cleanRole = String(role || 'worker').trim();
  return `CLAIM v1 | ${cleanId} | ${cleanRole}`;
}

/**
 * Build a canonical signed RESULT payload
 * @param {string} jobId
 * @param {string} solution
 * @returns {string}
 */
export function buildKibbleResultPayload(jobId, solution) {
  const cleanId = String(jobId || '').trim();
  const cleanSol = sweepSingleLine(solution);
  return `RESULT v1 | ${cleanId} | ${cleanSol}`;
}

/**
 * Build a canonical signed ATTEST payload
 * @param {string} jobId
 * @param {string} verdict - 'useful' or 'not'
 * @param {string} critique
 * @returns {string}
 */
export function buildKibbleAttestPayload(jobId, verdict, critique) {
  const cleanId = String(jobId || '').trim();
  const cleanVerdict = verdict === 'useful' ? 'useful' : 'not';
  const cleanCritique = sweepSingleLine(critique);
  return `ATTEST v1 | ${cleanId} | ${cleanVerdict} | ${cleanCritique}`;
}

/**
 * Aggregate a list of room messages into structured jobs with counts
 * @param {Array<object>} messages
 * @returns {object}
 */
export function aggregateKibbleBoard(messages = []) {
  const jobsMap = new Map();
  let countJobs = 0;
  let countClaims = 0;
  let countResults = 0;
  let countAttests = 0;

  for (const m of messages) {
    const parsed = parseKibbleMessage(m);
    if (!parsed) continue;

    if (parsed.type === 'JOB') {
      countJobs++;
      const existing = jobsMap.get(parsed.jobId);
      if (existing) {
        existing.category = parsed.category;
        existing.title = parsed.title;
        existing.description = parsed.description;
        existing.author = parsed.from;
        existing.ts = parsed.ts;
        existing.seq = parsed.seq;
      } else {
        jobsMap.set(parsed.jobId, {
          jobId: parsed.jobId,
          category: parsed.category,
          title: parsed.title,
          description: parsed.description,
          author: parsed.from,
          ts: parsed.ts,
          seq: parsed.seq,
          claims: [],
          results: [],
          attests: []
        });
      }
    } else if (parsed.type === 'CLAIM') {
      countClaims++;
      if (!jobsMap.has(parsed.jobId)) {
        jobsMap.set(parsed.jobId, {
          jobId: parsed.jobId,
          category: 'task',
          title: `Job ${parsed.jobId}`,
          description: 'Job referenced by active workers',
          author: 'unknown',
          ts: parsed.ts,
          seq: parsed.seq,
          claims: [],
          results: [],
          attests: []
        });
      }
      jobsMap.get(parsed.jobId).claims.push(parsed);
    } else if (parsed.type === 'RESULT') {
      countResults++;
      if (!jobsMap.has(parsed.jobId)) {
        jobsMap.set(parsed.jobId, {
          jobId: parsed.jobId,
          category: 'task',
          title: `Job ${parsed.jobId}`,
          description: 'Job deliverable submitted in stream',
          author: 'unknown',
          ts: parsed.ts,
          seq: parsed.seq,
          claims: [],
          results: [],
          attests: []
        });
      }
      jobsMap.get(parsed.jobId).results.push(parsed);
    } else if (parsed.type === 'ATTEST') {
      countAttests++;
      if (!jobsMap.has(parsed.jobId)) {
        jobsMap.set(parsed.jobId, {
          jobId: parsed.jobId,
          category: 'task',
          title: `Job ${parsed.jobId}`,
          description: 'Job reviewed by peer attestors',
          author: 'unknown',
          ts: parsed.ts,
          seq: parsed.seq,
          claims: [],
          results: [],
          attests: []
        });
      }
      jobsMap.get(parsed.jobId).attests.push(parsed);
    }
  }

  const jobsList = Array.from(jobsMap.values()).sort((a, b) => (b.seq || 0) - (a.seq || 0));

  return {
    total: messages.length,
    countJobs,
    countClaims,
    countResults,
    countAttests,
    jobs: jobsList
  };
}
