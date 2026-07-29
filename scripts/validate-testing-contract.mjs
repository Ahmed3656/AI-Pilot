import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [contractText, matrixText, openapiText, registryText, packageText] =
  await Promise.all(
    [
      '../docs/testing-mvp-contract.md',
      '../docs/testing-acceptance-matrix.md',
      '../docs/contracts/testing.openapi.json',
      '../docs/contracts/testing-registry.json',
      '../package.json',
    ].map(async (path) => readFile(new URL(path, import.meta.url), 'utf8')),
  );

const openapi = JSON.parse(openapiText);
const registry = JSON.parse(registryText);
const packageJson = JSON.parse(packageText);
const schemas = openapi.components.schemas;

function resolveLocalRef(ref) {
  return ref
    .slice(2)
    .split('/')
    .reduce(
      (value, segment) =>
        value?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')],
      openapi,
    );
}

function assertLocalRefsResolve(value) {
  if (Array.isArray(value)) {
    value.forEach(assertLocalRefsResolve);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
    assert.ok(
      resolveLocalRef(value.$ref),
      `Unresolved OpenAPI ref: ${value.$ref}`,
    );
  }
  Object.values(value).forEach(assertLocalRefsResolve);
}

function assertUnique(values, label) {
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} contains duplicate values`,
  );
}

function parameterRefNames(operation) {
  return (operation.parameters ?? [])
    .filter((parameter) => typeof parameter.$ref === 'string')
    .map((parameter) => parameter.$ref.split('/').at(-1));
}

function operationAt(method, path) {
  const operation = openapi.paths[path]?.[method];
  assert.ok(operation, `Missing operation ${method.toUpperCase()} ${path}`);
  return operation;
}

function matrixHasId(id) {
  return new RegExp(`\\|\\s*${id}\\s*\\|`).test(matrixText);
}

assertLocalRefsResolve(openapi);

assert.equal(openapi.openapi, '3.1.0');
assert.equal(openapi.info.version, '1.0.0');
assert.equal(registry.schemaVersion, '1.0.0');
assert.equal(registry.contractVersion, openapi.info.version);
assert.match(contractText, /Contract version: \*\*1\.0\.0\*\*/);
assert.match(matrixText, /version 1\.0\.0/);

// Baseline execution routes stay explicit so a generated domain inventory cannot hide path drift.
const baselineOperations = [
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/catalog',
    'getTestingCatalog',
    'testing.catalog.read',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/readiness',
    'getTestingReadiness',
    'testing.readiness.read',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/targets',
    'createTestingTarget',
    'testing.target.create',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/targets',
    'listTestingTargets',
    'testing.target.read',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/targets/{targetId}',
    'getTestingTarget',
    'testing.target.read',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/targets/{targetId}/verification-decisions',
    'decideTestingTargetVerification',
    'testing.target.verify',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/runs',
    'createTestingRun',
    'testing.run.create',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/runs',
    'listTestingRuns',
    'testing.run.read',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}',
    'getTestingRun',
    'testing.run.read',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/decisions/{decisionId}/resolve',
    'resolveTestingRunDecision',
    'testing.decision.resolve',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/control',
    'controlTestingRun',
    'testing.run.control',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/control/claim',
    'claimTestingRunControl',
    'testing.control.claim',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/control/renew',
    'renewTestingRunControl',
    'testing.control.claim',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/control/release',
    'releaseTestingRunControl',
    'testing.control.claim',
  ],
  [
    'post',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/viewer-tokens',
    'createTestingRunViewerToken',
    'testing.viewer.create',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/events',
    'listTestingRunEvents',
    'testing.run.read',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/findings',
    'listTestingRunFindings',
    'testing.finding.read',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/findings/{findingId}',
    'getTestingRunFinding',
    'testing.finding.read',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/evidence/{evidenceId}',
    'getTestingRunEvidence',
    'testing.evidence.read',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/evidence/{evidenceId}/content',
    'downloadTestingRunEvidence',
    'testing.evidence.read',
  ],
  [
    'get',
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/report',
    'getTestingRunReport',
    'testing.run.read',
  ],
  ['post', '/internal/v1/testing/jobs/claim', 'claimInternalTestingJob', null],
  [
    'post',
    '/internal/v1/testing/jobs/{jobId}/heartbeat',
    'heartbeatInternalTestingJob',
    null,
  ],
  [
    'post',
    '/internal/v1/testing/jobs/{jobId}/events',
    'appendInternalTestingJobEvent',
    null,
  ],
  [
    'post',
    '/internal/v1/testing/jobs/{jobId}/evidence',
    'uploadInternalTestingJobEvidence',
    null,
  ],
  [
    'post',
    '/internal/v1/testing/jobs/{jobId}/complete',
    'completeInternalTestingJob',
    null,
  ],
  [
    'post',
    '/internal/v1/testing/jobs/{jobId}/fail',
    'failInternalTestingJob',
    null,
  ],
  [
    'post',
    '/internal/v1/testing/viewer/authorize',
    'authorizeInternalTestingViewer',
    null,
  ],
];

// This manifest is deliberately independent from the registry projection. A family
// cannot pass drift validation by merely remaining internally self-consistent.
const requiredDomainFamilies = {
  organization_access: {
    schemas:
      'OrganizationResource MembershipResource AuthenticationSessionResource Role DomainEventHistoryResponse'.split(
        ' ',
      ),
    operations:
      'createAuthenticationSession refreshAuthenticationSession revokeAuthenticationSession createOrganization listOrganizations getOrganization listOrganizationMemberships createOrganizationMembership transitionOrganizationMembership listTestingDomainEvents'.split(
        ' ',
      ),
    permissions:
      'organization.create organization.read organization.membership.read organization.membership.manage authentication.session.manage'.split(
        ' ',
      ),
    statuses: 'organization membership authenticationSession'.split(' '),
    events:
      'organization.membership_changed authentication.session_changed'.split(
        ' ',
      ),
    errorCodes:
      'SESSION_INVALID UNAUTHENTICATED PERMISSION_DENIED TENANT_NOT_FOUND AUTHENTICATION_SESSION_NOT_FOUND MEMBERSHIP_NOT_FOUND STALE_RESOURCE_VERSION INVALID_DOMAIN_TRANSITION'.split(
        ' ',
      ),
    acceptance: 'DOMAIN-ORG-01 DOMAIN-ORG-02 DOMAIN-ORG-03'.split(' '),
  },
  project_environment: {
    schemas:
      'ProjectResource EnvironmentResource EnvironmentVersion TargetResource TargetVersion'.split(
        ' ',
      ),
    operations:
      'createTestingProject listTestingProjects getTestingProject transitionTestingProject createTestingEnvironment listTestingEnvironments getTestingEnvironment createTestingEnvironmentVersion decideTestingEnvironmentVerification createTestingTarget listTestingTargets getTestingTarget decideTestingTargetVerification'.split(
        ' ',
      ),
    permissions:
      'testing.project.read testing.project.create testing.project.manage testing.environment.read testing.environment.create testing.environment.manage testing.environment.verify testing.target.read testing.target.create testing.target.verify'.split(
        ' ',
      ),
    statuses: 'project environment target'.split(' '),
    events: ['project.environment_changed'],
    errorCodes:
      'TENANT_NOT_FOUND PROJECT_NOT_FOUND ENVIRONMENT_NOT_FOUND ENVIRONMENT_NOT_READY TARGET_NOT_FOUND TARGET_NOT_VERIFIED STALE_RESOURCE_VERSION VERSION_IMMUTABLE TARGET_VERIFICATION_CONFLICT'.split(
        ' ',
      ),
    acceptance:
      'DOMAIN-PROJECT-01 DOMAIN-PROJECT-02 DOMAIN-ENV-01 DOMAIN-ENV-02'.split(
        ' ',
      ),
  },
  application_state: {
    schemas:
      'ApplicationRoleResource CredentialHandleResource FixtureResource FixtureVersion FixtureInstance'.split(
        ' ',
      ),
    operations:
      'createTestingApplicationRole listTestingApplicationRoles transitionTestingApplicationRole registerTestingCredentialHandle listTestingCredentialHandles revokeTestingCredentialHandle createTestingFixture listTestingFixtures createTestingFixtureVersion reviewTestingFixtureVersion setupTestingFixture cleanupTestingFixture'.split(
        ' ',
      ),
    permissions:
      'testing.application_role.read testing.application_role.manage testing.credential_handle.read testing.credential_handle.manage testing.fixture.read testing.fixture.manage testing.fixture.setup'.split(
        ' ',
      ),
    statuses: 'applicationRole credentialHandle fixture fixtureInstance'.split(
      ' ',
    ),
    events: ['application.fixture_changed'],
    errorCodes:
      'APPLICATION_ROLE_NOT_FOUND CREDENTIAL_HANDLE_NOT_FOUND CREDENTIAL_HANDLE_EXPIRED FIXTURE_NOT_FOUND FIXTURE_VERSION_NOT_FOUND FIXTURE_INSTANCE_NOT_FOUND STALE_RESOURCE_VERSION VERSION_IMMUTABLE INVALID_DOMAIN_TRANSITION'.split(
        ' ',
      ),
    acceptance:
      'DOMAIN-APP-01 DOMAIN-APP-02 DOMAIN-FIXTURE-01 DOMAIN-FIXTURE-02'.split(
        ' ',
      ),
  },
  campaigns: {
    schemas: 'CampaignResource CreateCampaignRequest'.split(' '),
    operations:
      'createTestingCampaign listTestingCampaigns getTestingCampaign transitionTestingCampaign requestTestingCampaignPlanning'.split(
        ' ',
      ),
    permissions:
      'testing.campaign.read testing.campaign.create testing.campaign.control'.split(
        ' ',
      ),
    statuses: ['campaign'],
    events: ['campaign.status_changed'],
    errorCodes:
      'CAMPAIGN_NOT_FOUND ENVIRONMENT_NOT_READY PLAN_NOT_APPROVED STALE_RESOURCE_VERSION INVALID_DOMAIN_TRANSITION'.split(
        ' ',
      ),
    acceptance:
      'DOMAIN-CAMPAIGN-01 DOMAIN-CAMPAIGN-02 DOMAIN-CAMPAIGN-03'.split(' '),
  },
  requirements: {
    schemas:
      'RequirementSourceResource RequirementIngestionResource RequirementResource RequirementVersion'.split(
        ' ',
      ),
    operations:
      'createTestingRequirementSource listTestingRequirementSources transitionTestingRequirementSource ingestTestingRequirementSource listTestingRequirements getTestingRequirement createTestingRequirementVersion reviewTestingRequirementVersion completeInternalTestingRequirementIngestion failInternalTestingRequirementIngestion'.split(
        ' ',
      ),
    permissions:
      'testing.requirement.read testing.requirement.manage testing.requirement.review'.split(
        ' ',
      ),
    statuses: 'requirementSource requirementIngestion requirement'.split(' '),
    events: ['requirement.version_changed'],
    errorCodes:
      'REQUIREMENT_SOURCE_NOT_FOUND REQUIREMENT_INGESTION_NOT_FOUND REQUIREMENT_NOT_FOUND REQUIREMENT_VERSION_NOT_FOUND STALE_RESOURCE_VERSION VERSION_IMMUTABLE INVALID_DOMAIN_TRANSITION'.split(
        ' ',
      ),
    acceptance: 'DOMAIN-REQ-01 DOMAIN-REQ-02 DOMAIN-REQ-03 DOMAIN-REQ-04'.split(
      ' ',
    ),
  },
  discovery: {
    schemas:
      'DiscoveryResource DiscoveryVersion DiscoveryNode DiscoveryEdge'.split(
        ' ',
      ),
    operations:
      'createTestingDiscovery listTestingDiscoveries getTestingDiscovery listTestingDiscoveryVersions getTestingDiscoveryVersion completeInternalTestingDiscovery'.split(
        ' ',
      ),
    permissions: 'testing.discovery.read testing.discovery.create'.split(' '),
    statuses: ['discovery'],
    events: ['discovery.version_created'],
    errorCodes:
      'DISCOVERY_NOT_FOUND DISCOVERY_VERSION_NOT_FOUND VERSION_IMMUTABLE EVENT_ID_CONFLICT'.split(
        ' ',
      ),
    acceptance:
      'DOMAIN-DISCOVERY-01 DOMAIN-DISCOVERY-02 DOMAIN-DISCOVERY-03'.split(' '),
  },
  planning: {
    schemas:
      'PlanResource PlanVersion CriticalJourney TestCase TestStep OracleDefinition EvidenceRequirement'.split(
        ' ',
      ),
    operations:
      'createTestingPlan getTestingPlan getTestingPlanVersion reviewTestingPlanVersion createInternalTestingPlanVersion'.split(
        ' ',
      ),
    permissions:
      'testing.plan.read testing.plan.create testing.plan.review'.split(' '),
    statuses: ['plan'],
    events: ['plan.version_changed'],
    errorCodes:
      'PLAN_NOT_FOUND PLAN_VERSION_NOT_FOUND PLAN_NOT_APPROVED SIDE_EFFECT_NOT_ALLOWED STALE_RESOURCE_VERSION VERSION_IMMUTABLE INVALID_DOMAIN_TRANSITION'.split(
        ' ',
      ),
    acceptance:
      'DOMAIN-PLAN-01 DOMAIN-PLAN-02 DOMAIN-PLAN-03 DOMAIN-PLAN-04'.split(' '),
  },
  resource_governance: {
    schemas:
      'CampaignProfileResource CampaignProfileVersion ResourceBudget BudgetReservationResource ResourceUsage QuotaResource'.split(
        ' ',
      ),
    operations:
      'createTestingCampaignProfile listTestingCampaignProfiles createTestingCampaignProfileVersion getTestingQuota reserveTestingCampaignBudget getTestingBudgetReservation releaseTestingBudgetReservation getTestingCampaignUsage recordInternalTestingUsage'.split(
        ' ',
      ),
    permissions:
      'testing.campaign_profile.read testing.campaign_profile.manage testing.budget.read testing.budget.reserve'.split(
        ' ',
      ),
    statuses: 'campaignProfile budgetReservation'.split(' '),
    events: ['budget.usage_changed'],
    errorCodes:
      'CAMPAIGN_PROFILE_NOT_FOUND BUDGET_RESERVATION_NOT_FOUND BUDGET_RESERVATION_EXHAUSTED CLEANUP_RESERVE_EXHAUSTED QUOTA_EXCEEDED STALE_RESOURCE_VERSION VERSION_IMMUTABLE'.split(
        ' ',
      ),
    acceptance:
      'DOMAIN-BUDGET-01 DOMAIN-BUDGET-02 DOMAIN-BUDGET-03 DOMAIN-BUDGET-04'.split(
        ' ',
      ),
  },
  findings: {
    schemas:
      'CanonicalFindingResource FindingOccurrenceResource FindingComment FindingAssignment FixClaimResource RetestResource RiskAcceptanceResource'.split(
        ' ',
      ),
    operations:
      'listTestingRunFindings getTestingRunFinding listTestingFindings getTestingFinding assignTestingFinding commentOnTestingFinding markTestingFindingExpectedBehavior createTestingFindingFixClaim requestTestingFindingRetest closeTestingFinding createTestingFindingRiskAcceptance revokeTestingFindingRiskAcceptance'.split(
        ' ',
      ),
    permissions:
      'testing.finding.read testing.finding.triage testing.finding.comment testing.finding.assign testing.finding.retest testing.finding.risk_accept'.split(
        ' ',
      ),
    statuses: 'finding fixClaim retest riskAcceptance'.split(' '),
    events:
      'finding.created finding.occurrence_recorded finding.lifecycle_changed'.split(
        ' ',
      ),
    errorCodes:
      'CANONICAL_FINDING_NOT_FOUND FINDING_OCCURRENCE_NOT_FOUND FIX_CLAIM_NOT_FOUND RETEST_NOT_FOUND RISK_ACCEPTANCE_NOT_FOUND STALE_RESOURCE_VERSION VERSION_IMMUTABLE INVALID_DOMAIN_TRANSITION'.split(
        ' ',
      ),
    acceptance:
      'DOMAIN-FINDING-01 DOMAIN-FINDING-02 DOMAIN-FINDING-03 DOMAIN-FINDING-04 DOMAIN-FINDING-05'.split(
        ' ',
      ),
  },
  results_exports: {
    schemas:
      'CampaignReadinessReport CoverageDisclosure ExportResource CampaignFinalResult RunReport'.split(
        ' ',
      ),
    operations:
      'getTestingCampaignReadinessReport getTestingCampaignCoverage createTestingCampaignExport getTestingCampaignExport getTestingCampaignFinalResult finalizeInternalTestingCampaignResult'.split(
        ' ',
      ),
    permissions: 'testing.result.read testing.result.export'.split(' '),
    statuses: 'export report'.split(' '),
    events: 'campaign.result_finalized export.completed report.finalized'.split(
      ' ',
    ),
    errorCodes:
      'CAMPAIGN_NOT_FOUND EXPORT_NOT_FOUND EXPORT_EXPIRED FINAL_RESULT_NOT_READY VERSION_IMMUTABLE'.split(
        ' ',
      ),
    acceptance:
      'DOMAIN-RESULT-01 DOMAIN-RESULT-02 DOMAIN-RESULT-03 DOMAIN-RESULT-04'.split(
        ' ',
      ),
  },
  execution_relationships: {
    schemas:
      'ExecutionRelationship RunResource JobLease EvidenceResource RunReport'.split(
        ' ',
      ),
    operations:
      'createTestingRun getTestingRun getTestingCampaignExecutionGraph claimInternalTestingJob appendInternalTestingJobEvent uploadInternalTestingJobEvidence completeInternalTestingJob failInternalTestingJob'.split(
        ' ',
      ),
    permissions:
      'testing.run.read testing.run.create testing.run.control testing.evidence.read'.split(
        ' ',
      ),
    statuses: 'run job evidence'.split(' '),
    events:
      'run.created run.status_changed evidence.captured run.completed run.failed run.cancelled'.split(
        ' ',
      ),
    errorCodes:
      'CAMPAIGN_NOT_FOUND PLAN_VERSION_NOT_FOUND RUN_NOT_FOUND JOB_NOT_FOUND EVIDENCE_NOT_FOUND FINDING_OCCURRENCE_NOT_FOUND INVALID_JOB_LEASE JOB_LEASE_CONFLICT JOB_LEASE_EXPIRED INVALID_RUN_TRANSITION'.split(
        ' ',
      ),
    acceptance: 'DOMAIN-REL-01 DOMAIN-REL-02 DOMAIN-REL-03'.split(' '),
  },
};

assert.deepEqual(
  Object.keys(registry.domainFamilies),
  Object.keys(requiredDomainFamilies),
);
const operationsById = new Map();
for (const [path, pathItem] of Object.entries(openapi.paths)) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = pathItem[method];
    if (!operation) continue;
    assert.ok(
      operation.operationId,
      `Missing operationId on ${method} ${path}`,
    );
    assert.ok(
      !operationsById.has(operation.operationId),
      `Duplicate operationId ${operation.operationId}`,
    );
    operationsById.set(operation.operationId, { method, path, operation });
  }
}

for (const [familyName, expectedFamily] of Object.entries(
  requiredDomainFamilies,
)) {
  assert.deepEqual(
    registry.domainFamilies[familyName],
    expectedFamily,
    `Required domain family drift: ${familyName}`,
  );
  for (const schemaName of expectedFamily.schemas) {
    assert.ok(schemas[schemaName], `${familyName} lacks schema ${schemaName}`);
  }
  for (const operationId of expectedFamily.operations) {
    assert.ok(
      operationsById.has(operationId),
      `${familyName} lacks operation ${operationId}`,
    );
  }
  for (const permission of expectedFamily.permissions) {
    assert.ok(
      registry.permissions.includes(permission),
      `${familyName} lacks permission ${permission}`,
    );
  }
  for (const statusName of expectedFamily.statuses) {
    assert.ok(
      registry.statuses[statusName],
      `${familyName} lacks status family ${statusName}`,
    );
  }
  for (const eventType of expectedFamily.events) {
    assert.ok(
      registry.events.includes(eventType),
      `${familyName} lacks event ${eventType}`,
    );
  }
  for (const errorCode of expectedFamily.errorCodes) {
    assert.ok(
      registry.errorCodes.some(({ code }) => code === errorCode),
      `${familyName} lacks stable error ${errorCode}`,
    );
  }
  for (const acceptanceId of expectedFamily.acceptance) {
    assert.ok(
      matrixHasId(acceptanceId),
      `${familyName} lacks acceptance trace ${acceptanceId}`,
    );
  }
}

for (const [method, path, operationId, permission] of baselineOperations) {
  const operation = operationAt(method, path);
  assert.equal(operation.operationId, operationId);
  assert.equal(operation['x-required-permission'], permission ?? undefined);
}

const anonymousOperations = new Set([
  'createAuthenticationSession',
  'refreshAuthenticationSession',
]);
for (const [operationId, { method, path, operation }] of operationsById) {
  assert.ok(
    matrixText.includes(`\`${operationId}\``),
    `Acceptance matrix does not trace ${operationId}`,
  );
  if (path.startsWith('/api/')) {
    if (anonymousOperations.has(operationId)) {
      assert.deepEqual(operation.security, []);
      assert.equal(operation['x-required-permission'], undefined);
    } else {
      assert.deepEqual(operation.security, [{ userBearer: [] }]);
      const permission = operation['x-required-permission'];
      assert.ok(permission, `${operationId} lacks x-required-permission`);
      assert.ok(
        registry.permissions.includes(permission),
        `${operationId} uses unknown permission ${permission}`,
      );
    }
    if (path.includes('{tenantId}')) {
      assert.ok(
        parameterRefNames(operation).includes('TenantId'),
        `${operationId} lacks TenantId path parameter`,
      );
    }
    if (method === 'post') {
      assert.ok(
        parameterRefNames(operation).includes('IdempotencyKey'),
        `${operationId} is missing Idempotency-Key`,
      );
    }
  } else {
    assert.ok(path.startsWith('/internal/v1/testing/'));
    assert.ok(
      operation.security.some((requirement) => 'internalToken' in requirement),
      `${operationId} is missing internal authentication`,
    );
    assert.equal(operation['x-required-permission'], undefined);
  }
}

const leasedJobOperations = baselineOperations
  .filter(([, path]) => path.includes('/jobs/{jobId}/'))
  .map(([, , operationId]) => operationId);
for (const operationId of leasedJobOperations) {
  const [, path] = baselineOperations.find(
    ([, , candidate]) => candidate === operationId,
  );
  const security = operationAt('post', path).security;
  assert.ok(
    security.some(
      (requirement) =>
        'internalToken' in requirement && 'jobLeaseToken' in requirement,
    ),
    `${operationId} must require both internal and job-lease tokens`,
  );
}

assert.deepEqual(schemas.TargetStatus.enum, registry.statuses.target);
assert.deepEqual(schemas.RunStatus.enum, registry.statuses.run);
assert.deepEqual(
  schemas.RunStatus['x-allowed-transitions'],
  registry.runTransitions,
);
assert.deepEqual(schemas.JobStatus.enum, registry.statuses.job);
assert.deepEqual(schemas.DecisionStatus.enum, registry.statuses.decision);
assert.deepEqual(schemas.DecisionType.enum, registry.decisionTypes);
assert.deepEqual(schemas.DecisionOutcome.enum, registry.decisionOutcomes);
assert.deepEqual(schemas.SideEffectClass.enum, registry.sideEffectClasses);
assert.deepEqual(schemas.OracleType.enum, registry.oracleTypes);
assert.deepEqual(schemas.FailureSource.enum, registry.failureSources);
assert.deepEqual(schemas.FindingState.enum, registry.findingStates);
assert.deepEqual(
  schemas.FindingState['x-allowed-transitions'],
  registry.findingTransitions,
);
assert.deepEqual(schemas.FindingType.enum, registry.findingTypes);
assert.deepEqual(schemas.FindingSeverity.enum, registry.findingSeverities);
assert.deepEqual(schemas.FindingConfidence.enum, registry.findingConfidences);
assert.deepEqual(schemas.EvidenceKind.enum, registry.evidenceKinds);
assert.deepEqual(
  schemas.EvidenceKind['x-media-types'],
  registry.evidenceMediaTypes,
);
assert.deepEqual(schemas.EvidenceStatus.enum, registry.statuses.evidence);
assert.deepEqual(
  schemas.ControlLeaseStatus.enum,
  registry.statuses.controlLease,
);
assert.deepEqual(schemas.ReportStatus.enum, registry.statuses.report);
for (const [schemaName, statusName] of Object.entries({
  OrganizationStatus: 'organization',
  MembershipStatus: 'membership',
  AuthenticationSessionStatus: 'authenticationSession',
  ProjectStatus: 'project',
  EnvironmentStatus: 'environment',
  ApplicationRoleStatus: 'applicationRole',
  CredentialHandleStatus: 'credentialHandle',
  FixtureStatus: 'fixture',
  FixtureInstanceStatus: 'fixtureInstance',
  CampaignStatus: 'campaign',
  RequirementSourceStatus: 'requirementSource',
  RequirementIngestionStatus: 'requirementIngestion',
  RequirementStatus: 'requirement',
  DiscoveryStatus: 'discovery',
  PlanStatus: 'plan',
  CampaignProfileStatus: 'campaignProfile',
  BudgetReservationStatus: 'budgetReservation',
  FixClaimStatus: 'fixClaim',
  RetestStatus: 'retest',
  RiskAcceptanceStatus: 'riskAcceptance',
  ExportStatus: 'export',
})) {
  assert.deepEqual(
    schemas[schemaName].enum,
    registry.statuses[statusName],
    `${schemaName} enum drift`,
  );
  if (registry.lifecycleTransitions[statusName]) {
    assert.deepEqual(
      schemas[schemaName]['x-allowed-transitions'],
      registry.lifecycleTransitions[statusName],
      `${schemaName} transition drift`,
    );
  }
}
assert.deepEqual(schemas.EventType.enum, registry.events);
assert.deepEqual(schemas.DomainEventType.enum, registry.eventScopes.domain);
assert.deepEqual(schemas.RunEventType.enum, registry.eventScopes.run);
assert.equal(
  schemas.AppendJobEventRequest.properties.type.$ref,
  '#/components/schemas/RunEventType',
);
assert.deepEqual(schemas.ReadinessStatus.enum, registry.statuses.readiness);
assert.deepEqual(
  schemas.ReadinessGateStatus.enum,
  registry.statuses.readinessGate,
);
assert.deepEqual(schemas.ReadinessGateName.enum, registry.readinessGates);

const expectedInferenceCapabilities = [
  'structured_output',
  'tool_call_proposals',
  'cancellation',
  'timeout',
  'bounded_context',
  'bounded_output',
  'deterministic_failures',
];
const expectedInferenceFailures = [
  'unavailable',
  'timeout',
  'cancelled',
  'capability_missing',
  'context_limit',
  'output_limit',
  'invalid_structured_output',
  'retry_exhausted',
];
assert.equal(registry.inference.providerClass, 'self_hosted_open_weight');
assert.equal(registry.inference.interfaceVersion, registry.contractVersion);
assert.deepEqual(
  registry.inference.requiredCapabilities,
  expectedInferenceCapabilities,
);
assert.deepEqual(registry.inference.conditionalCapabilities, {
  visual: ['vision_input'],
});
assert.deepEqual(registry.inference.failureReasons, expectedInferenceFailures);
assert.equal(registry.inference.minimumContextTokens, 8192);
assert.equal(registry.inference.minimumOutputTokens, 1024);
assert.equal(registry.inference.defaultTimeoutSeconds, 60);
assert.equal(registry.inference.maximumTimeoutSeconds, 120);
assert.equal(registry.inference.maximumAttempts, 2);
assert.deepEqual(registry.inference.retryDelaySeconds, [1]);
assertUnique(
  registry.inference.requiredCapabilities,
  'inference.requiredCapabilities',
);
assertUnique(registry.inference.failureReasons, 'inference.failureReasons');

const inferenceSchema = schemas.InferenceCapabilityDeclaration;
assert.deepEqual(inferenceSchema.required, [
  'interfaceVersion',
  'structuredOutput',
  'toolCallProposals',
  'visionInput',
  'cancellation',
  'timeout',
  'deterministicFailures',
  'supportedSchemaVersions',
  'maxContextTokens',
  'maxOutputTokens',
]);
assert.equal(inferenceSchema.additionalProperties, false);
assert.equal(
  inferenceSchema.properties.interfaceVersion.const,
  registry.inference.interfaceVersion,
);
for (const capability of [
  'structuredOutput',
  'toolCallProposals',
  'cancellation',
  'timeout',
  'deterministicFailures',
]) {
  assert.equal(inferenceSchema.properties[capability].const, true);
}
assert.equal(
  inferenceSchema.properties.maxContextTokens.minimum,
  registry.inference.minimumContextTokens,
);
assert.equal(
  inferenceSchema.properties.maxOutputTokens.minimum,
  registry.inference.minimumOutputTokens,
);
assert.equal(
  inferenceSchema.properties.supportedSchemaVersions.items.const,
  registry.contractVersion,
);

assert.deepEqual(
  schemas.ProfileKey.enum,
  registry.profiles.map(({ key }) => key),
);
assert.deepEqual(schemas.ProfileDefinition.enum, registry.profiles);
assert.deepEqual(
  schemas.PackKey.enum,
  registry.packs.map(({ key }) => key),
);
assert.deepEqual(schemas.PackDefinition.enum, registry.packs);
for (const profile of registry.profiles) {
  assert.equal(profile.version, registry.contractVersion);
}
for (const pack of registry.packs) {
  assert.equal(pack.version, registry.contractVersion);
  assertUnique(pack.oracleTypes, `pack ${pack.key} oracleTypes`);
  assert.ok(
    pack.oracleTypes.every((oracleType) =>
      registry.oracleTypes.includes(oracleType),
    ),
  );
}

for (const [label, values] of Object.entries({
  events: registry.events,
  permissions: registry.permissions,
  sideEffectClasses: registry.sideEffectClasses,
  oracleTypes: registry.oracleTypes,
  failureSources: registry.failureSources,
  findingStates: registry.findingStates,
  findingTypes: registry.findingTypes,
  findingSeverities: registry.findingSeverities,
  findingConfidences: registry.findingConfidences,
  evidenceKinds: registry.evidenceKinds,
  readinessGates: registry.readinessGates,
})) {
  assertUnique(values, label);
}
for (const [label, values] of Object.entries(registry.statuses)) {
  assertUnique(values, `statuses.${label}`);
}
for (const [statusName, transitions] of Object.entries(
  registry.lifecycleTransitions,
)) {
  assert.deepEqual(
    Object.keys(transitions),
    registry.statuses[statusName],
    `Transition table must cover every ${statusName} status exactly once`,
  );
  for (const [from, destinations] of Object.entries(transitions)) {
    assertUnique(destinations, `lifecycleTransitions.${statusName}.${from}`);
    assert.ok(
      destinations.every((to) => registry.statuses[statusName].includes(to)),
      `Unknown ${statusName} transition from ${from}`,
    );
  }
}
assert.deepEqual(
  Object.keys(registry.findingTransitions),
  registry.findingStates,
);
for (const [from, destinations] of Object.entries(
  registry.findingTransitions,
)) {
  assertUnique(destinations, `findingTransitions.${from}`);
  assert.ok(destinations.every((to) => registry.findingStates.includes(to)));
}
for (const [role, inheritedRoles] of Object.entries(registry.roleInherits)) {
  assert.ok(registry.roles.includes(role));
  assertUnique(inheritedRoles, `roleInherits.${role}`);
  assert.ok(
    inheritedRoles.every((candidate) => registry.roles.includes(candidate)),
  );
}
for (const [role, permissions] of Object.entries(
  registry.rolePermissionGrants,
)) {
  assert.ok(registry.roles.includes(role));
  assertUnique(permissions, `rolePermissionGrants.${role}`);
  assert.ok(
    permissions.every((permission) =>
      registry.permissions.includes(permission),
    ),
  );
}
for (const [schemaName, registryValues] of Object.entries({
  Role: registry.roles,
  EnvironmentType: registry.environmentTypes,
  ProductionPolicy: registry.productionPolicies,
  ApplicationRoleType: registry.applicationRoleTypes,
  RequirementSourceType: registry.requirementSourceTypes,
  ReviewOutcome: registry.reviewOutcomes,
  DiscoveryNodeType: registry.discoveryNodeTypes,
  DiscoveryEdgeType: registry.discoveryEdgeTypes,
  QuotaScope: registry.quotaScopes,
  ExportFormat: registry.exportFormats,
})) {
  assert.deepEqual(schemas[schemaName].enum, registryValues);
  assertUnique(registryValues, schemaName);
}

for (const family of Object.values(requiredDomainFamilies)) {
  for (const schemaName of family.schemas) {
    const schema = schemas[schemaName];
    if (schema.type === 'object') {
      assert.equal(
        schema.additionalProperties,
        false,
        `${schemaName} must reject unknown properties`,
      );
      assert.deepEqual(
        [...schema.required].sort(),
        Object.keys(schema.properties).sort(),
        `${schemaName} must declare every property required or model null explicitly`,
      );
    }
  }
}

for (const [operationId, { operation }] of operationsById) {
  for (const media of Object.values(operation.requestBody?.content ?? {})) {
    const requestSchema = media.schema?.$ref
      ? resolveLocalRef(media.schema.$ref)
      : media.schema;
    if (requestSchema?.type === 'object') {
      assert.equal(
        requestSchema.additionalProperties,
        false,
        `${operationId} request DTO must reject unknown properties`,
      );
    }
  }
}

for (const operationId of [
  'transitionOrganizationMembership',
  'transitionTestingProject',
  'createTestingEnvironmentVersion',
  'decideTestingEnvironmentVerification',
  'transitionTestingApplicationRole',
  'createTestingFixtureVersion',
  'reviewTestingFixtureVersion',
  'transitionTestingCampaign',
  'requestTestingCampaignPlanning',
  'transitionTestingRequirementSource',
  'createTestingRequirementVersion',
  'reviewTestingRequirementVersion',
  'reviewTestingPlanVersion',
  'createTestingCampaignProfileVersion',
  'releaseTestingBudgetReservation',
  'assignTestingFinding',
  'markTestingFindingExpectedBehavior',
  'createTestingFindingFixClaim',
  'requestTestingFindingRetest',
  'closeTestingFinding',
  'createTestingFindingRiskAcceptance',
]) {
  const requestRef =
    operationsById.get(operationId).operation.requestBody.content[
      'application/json'
    ].schema.$ref;
  assert.ok(
    resolveLocalRef(requestRef).properties.expectedVersion,
    `${operationId} lacks optimistic concurrency`,
  );
}

for (const operationId of [
  'completeInternalTestingRequirementIngestion',
  'failInternalTestingRequirementIngestion',
  'completeInternalTestingDiscovery',
  'createInternalTestingPlanVersion',
  'recordInternalTestingUsage',
  'finalizeInternalTestingCampaignResult',
]) {
  const requestRef =
    operationsById.get(operationId).operation.requestBody.content[
      'application/json'
    ].schema.$ref;
  const properties = resolveLocalRef(requestRef).properties;
  assert.ok(
    properties.eventId ?? properties.usageEventId,
    `${operationId} lacks a deterministic event ID`,
  );
}

for (const [operationId, { operation }] of operationsById) {
  if (
    operationId.startsWith('list') &&
    !['listTestingRunEvents', 'listTestingDomainEvents'].includes(operationId)
  ) {
    const parameters = parameterRefNames(operation);
    assert.ok(parameters.includes('Cursor'), `${operationId} lacks cursor`);
    assert.ok(parameters.includes('Limit'), `${operationId} lacks limit`);
  }
}
assert.ok(
  operationsById
    .get('listTestingDomainEvents')
    .operation.parameters.some((parameter) => parameter.name === 'after'),
);

const payloadSchemas = schemas.EventType['x-payload-schemas'];
assert.deepEqual(
  Object.keys(payloadSchemas).sort(),
  [...registry.events].sort(),
);
assert.deepEqual(
  schemas.AppendJobEventRequest['x-type-payload-map'],
  Object.fromEntries(
    registry.eventScopes.run.map((eventType) => [
      eventType,
      payloadSchemas[eventType],
    ]),
  ),
);
for (const schemaName of Object.values(payloadSchemas)) {
  assert.ok(schemas[schemaName], `Missing event payload schema ${schemaName}`);
  assert.equal(schemas[schemaName].additionalProperties, false);
}
assertUnique(
  [...registry.eventScopes.domain, ...registry.eventScopes.run],
  'eventScopes',
);
assert.deepEqual(
  [...registry.eventScopes.domain, ...registry.eventScopes.run],
  registry.events,
);
assert.equal(
  schemas.EventEnvelope.oneOf.length,
  registry.eventScopes.run.length,
);
assert.deepEqual(
  Object.keys(schemas.EventEnvelope.discriminator.mapping),
  registry.eventScopes.run,
);
assert.equal(
  schemas.DomainEventEnvelope.oneOf.length,
  registry.eventScopes.domain.length,
);
assert.deepEqual(
  Object.keys(schemas.DomainEventEnvelope.discriminator.mapping),
  registry.eventScopes.domain,
);

const errorCodes = registry.errorCodes.map(({ code }) => code);
assertUnique(errorCodes, 'errorCodes');
assert.deepEqual(schemas.StableErrorCode.enum, errorCodes);
for (const { code, httpStatus } of registry.errorCodes) {
  assert.ok(
    Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus < 600,
  );
  assert.ok(contractText.includes(code), `${code} is absent from the contract`);
}

assert.equal(schemas.Timestamp.type, 'string');
assert.equal(schemas.Timestamp.format, 'date-time');
assert.ok(schemas.Timestamp.pattern.endsWith('Z$'));
assert.equal(schemas.DecimalString.type, 'string');
assert.equal(schemas.DecimalIntegerString.type, 'string');
assert.equal(
  schemas.ProfileReference.properties.version.const,
  registry.contractVersion,
);
assert.equal(
  schemas.PackReference.properties.version.const,
  registry.contractVersion,
);
assert.equal(
  schemas.RunPlanSnapshot.properties.catalogVersion.const,
  registry.contractVersion,
);
assert.deepEqual(Object.keys(schemas.OrganizationResource.properties), [
  'id',
  'name',
  'status',
  'version',
  'createdAt',
  'updatedAt',
]);
for (const field of [
  'projectId',
  'environmentId',
  'campaignId',
  'approvedPlanVersionId',
  'budgetReservationId',
]) {
  assert.ok(schemas.RunResource.required.includes(field));
}
assert.ok(schemas.JobLease.required.includes('runId'));
assert.ok(schemas.EvidenceResource.required.includes('runId'));
assert.ok(schemas.FindingOccurrenceResource.required.includes('runId'));
assert.ok(
  schemas.FindingOccurrenceResource.required.includes('canonicalFindingId'),
);
assert.equal(schemas.FindingOccurrenceResource.properties.state, undefined);
assert.equal(schemas.FindingOccurrenceResource.properties.version, undefined);
assert.ok(schemas.CanonicalFindingResource.properties.state);
assert.equal(
  schemas.RiskAcceptanceResource.properties.findingId.type,
  'string',
);
assert.ok(
  schemas.CampaignFinalResult.required.includes('approvedPlanVersionId'),
);
assert.ok(schemas.CampaignFinalResult.required.includes('runIds'));
assert.equal(
  schemas.RegisterCredentialHandleRequest.properties.secret.writeOnly,
  true,
);
assert.equal(schemas.CredentialHandleResource.properties.secret, undefined);
for (const schemaName of [
  'ResourceBudget',
  'ResourceUsage',
  'QuotaResource',
  'BudgetReservationResource',
]) {
  const names = JSON.stringify(schemas[schemaName]).toLowerCase();
  assert.ok(!/(currency|price|payment|invoice|billing|credit)/.test(names));
}
for (const versionSchema of [
  'EnvironmentVersion',
  'TargetVersion',
  'FixtureVersion',
  'RequirementVersion',
  'DiscoveryVersion',
  'PlanVersion',
  'CampaignProfileVersion',
  'CampaignFinalResult',
]) {
  assert.equal(
    schemas[versionSchema].properties.updatedAt,
    undefined,
    `${versionSchema} must be immutable`,
  );
}
assert.match(
  contractText,
  /Its `id` is the canonical tenant identifier and is serialized as `tenantId`/,
);
assert.match(contractText, /A run is exactly one immutable execution attempt/);
assert.match(contractText, /Risk acceptance is stored separately/);

assert.equal(registry.readinessGates.length, 12);
assert.equal(
  schemas.ReadinessSnapshot.properties.gates.minItems,
  registry.readinessGates.length,
);
assert.equal(
  schemas.ReadinessSnapshot.properties.gates.maxItems,
  registry.readinessGates.length,
);
assert.deepEqual(schemas.ReadinessSnapshot.properties.inference.oneOf, [
  { $ref: '#/components/schemas/InferenceCapabilityDeclaration' },
  { type: 'null' },
]);
assert.equal(
  openapi.paths['/api/v1/tenants/{tenantId}/testing/runs/{runId}/events'].get[
    'x-websocket'
  ].cursorExpiredCloseCode,
  4009,
);
assert.equal(
  openapi.paths[
    '/api/v1/tenants/{tenantId}/testing/runs/{runId}/evidence/{evidenceId}/content'
  ].get.responses['200'].headers['Cache-Control'].schema.const,
  'private, no-store',
);
assert.equal(
  openapi.paths['/api/v1/tenants/{tenantId}/testing/runs/{runId}/viewer-tokens']
    .get,
  undefined,
);

for (let index = 1; index <= 15; index += 1) {
  const id = `SAFE-${String(index).padStart(2, '0')}`;
  assert.ok(matrixHasId(id), `Missing safety trace ${id}`);
}

for (const id of [
  'AI-LOCAL-01',
  'AI-LOCAL-02',
  'AI-LOCAL-03',
  'AI-BENCH-01',
  'AI-READY-01',
  'AI-READY-02',
  'AI-AUTH-01',
  'AI-LEAK-01',
  'AI-TRANSCRIPT-01',
  'DEFER-01',
]) {
  assert.ok(matrixHasId(id), `Missing AI trace ${id}`);
}

for (const phrase of [
  'active penetration testing',
  'load, stress, soak',
  'live payments',
  'irreversible',
  'native mobile',
  'unverified',
]) {
  assert.ok(
    contractText.toLowerCase().includes(phrase),
    `Missing deliberate exclusion: ${phrase}`,
  );
}

for (const phrase of [
  'required mvp inference provider class is `self_hosted_open_weight`',
  'without paid inference apis',
  'external ai api keys',
  'paid hosted inference providers are outside mvp scope',
  'self-hosting removes hosted-provider fees',
  'ai output is always untrusted proposal data',
  'hidden reasoning',
  'raw model transcripts',
  'p20 and p32 own runtime adapters',
]) {
  assert.ok(
    contractText.toLowerCase().includes(phrase),
    `Missing local-inference invariant: ${phrase}`,
  );
}
assert.ok(!contractText.includes('AI/model provider'));

for (const forbidden of [
  '/api/v1/shopping',
  'DealPilot Egypt MVP Contract',
  'pause_ai',
  'resume_ai',
]) {
  assert.ok(
    !openapiText.includes(forbidden),
    `Testing OpenAPI contains legacy alias/content: ${forbidden}`,
  );
  assert.ok(
    !registryText.includes(forbidden),
    `Testing registry contains legacy alias/content: ${forbidden}`,
  );
}

const publicMachineText = `${openapiText}\n${registryText}`.toLowerCase();
for (const vendor of [
  'openrouter',
  'openai',
  'anthropic',
  'azure openai',
  'bedrock',
  'gemini',
  'cohere',
]) {
  assert.ok(
    !publicMachineText.includes(vendor),
    `Public testing contracts contain hosted-provider identity: ${vendor}`,
  );
  assert.ok(
    !errorCodes.some((code) => code.toLowerCase().includes(vendor)),
    `Stable error code contains hosted-provider identity: ${vendor}`,
  );
}
for (const externalKeyName of [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
]) {
  assert.ok(
    !publicMachineText.includes(externalKeyName.toLowerCase()),
    `Public testing contracts contain external key name: ${externalKeyName}`,
  );
}
assert.ok(!openapiText.includes('self_hosted_open_weight'));
assert.equal(
  openapi.servers[0].variables.origin.default,
  'http://localhost:8080',
);

const publicSchemaPropertyNames = [];
function collectSchemaPropertyNames(value) {
  if (Array.isArray(value)) {
    value.forEach(collectSchemaPropertyNames);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (value.properties) {
    publicSchemaPropertyNames.push(...Object.keys(value.properties));
  }
  Object.values(value).forEach(collectSchemaPropertyNames);
}
collectSchemaPropertyNames(schemas);
for (const forbiddenProperty of [
  /model/i,
  /provider/i,
  /engine/i,
  /sdk/i,
  /apiKey/i,
  /localPath/i,
  /filesystem/i,
  /rawTranscript/i,
  /reasoning/i,
]) {
  assert.ok(
    !publicSchemaPropertyNames.some((name) => forbiddenProperty.test(name)),
    `Public schema exposes forbidden inference property: ${forbiddenProperty}`,
  );
}
assert.ok(
  !/"(?:model|engine|sdk|apiKey|localPath|filesystemPath)"\s*:/i.test(
    registryText,
  ),
);
assert.ok(!/\b(?:file|https?):\/\//i.test(registryText));
assert.ok(!/\b(?:hosted|paid)_/i.test(registryText));

assert.equal(
  packageJson.scripts['test:testing-contract'],
  'node scripts/validate-testing-contract.mjs',
);
assert.match(
  packageJson.scripts['test:contract'],
  /validate-mvp-contract\.mjs/,
);
assert.match(packageJson.scripts['test:contract'], /test:testing-contract/);
assert.match(packageJson.scripts.test, /test:contract/);

console.log(
  'Autonomous testing MVP contract, registry, OpenAPI, and acceptance matrix are internally consistent.',
);
