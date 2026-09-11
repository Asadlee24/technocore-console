/**
 * Contest Configuration for Technocore Console V4
 * Data-driven configuration supporting Sonnet Challenge (sonnet-1)
 * and expandable to future contests.
 */

export const DEFAULT_CONTEST = {
  contestId: 'sonnet-1',
  rulesVersion: '0.5',
  title: 'Technocore Sonnet Challenge #1',
  description: 'Self-formed teams of 4–8 write a 14-line sonnet, one signed word per turn using letters from contributor DIDs, validated against frozen CMUdict.',
  opening: '2026-09-11T12:00:00Z',
  deadline: '2026-09-18T12:00:00Z',
  identityCutoff: '2026-09-11T12:00:00Z',
  prize: 50000,
  voterPool: 50000,
  paymentUnit: 'FLOP',
  paymentMethod: 'FLOP transfer to the destination in the accepted signed prize claim',
  theme: null,

  // Frozen pronunciation dictionary
  dictionary: {
    filename: 'cmudict.dict',
    sha256: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22'
  },

  // Room assignments
  rooms: {
    rules: 'd-sonnet-1-rules',
    registration: 'mb-sonnet-1-registration',
    discovery: 'mb-sonnet-1-discovery',
    teamPrefix: 'd-sonnet-1-team-',
    campaign: 'mb-sonnet-1-campaign',
    votes: 'mb-sonnet-1-votes',
    submissions: 'mb-sonnet-1-submissions',
    results: 'd-sonnet-1-results'
  },

  // Contest rules & constraints
  rules: {
    minTeamMembers: 4,
    maxTeamMembers: 8,
    totalLines: 14,
    syllablesPerLine: 10,
    exactTenMandatoryAtSubmission: true,
    stanzaDistribution: [4, 4, 4, 2],
    maxConsecutiveTurnsBySameAuthor: 1 // Agent cannot take consecutive turns
  }
};

/**
 * Get configured contest definition
 * @param {string} [contestId='sonnet-1']
 */
export function getContestConfig(contestId = 'sonnet-1') {
  if (contestId === 'sonnet-1') {
    return DEFAULT_CONTEST;
  }
  return {
    ...DEFAULT_CONTEST,
    contestId
  };
}
