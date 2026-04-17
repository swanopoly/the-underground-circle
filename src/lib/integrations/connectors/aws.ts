/**
 * AWS connector — IAM Role + External ID pattern.
 *
 * AWS doesn't use OAuth for service-to-service access. The recommended SaaS
 * pattern is the customer creates a cross-account IAM Role in their own AWS
 * account, configures its trust policy to allow Underground Circle's AWS
 * account to assume it, and gives us the role ARN.
 *
 * This protects against the "confused deputy" problem via an external ID
 * that only the customer + we know — even if our AWS account ID leaks, no
 * other tenant's role can be assumed without their unique external ID.
 *
 * Connect flow:
 *   1. UC generates a per-circle external ID (random, persisted in
 *      circle_integration_secrets as `external_id`).
 *   2. UC shows the customer a CloudFormation template (or instructions)
 *      to create the IAM Role with the right trust policy + permissions.
 *   3. Customer pastes the role ARN back into UC.
 *   4. We store: role_arn, external_id (encrypted) in
 *      circle_integration_secrets.
 *   5. On every API call, our edge function calls sts:AssumeRole with the
 *      external ID, gets short-lived credentials, makes the AWS call.
 *
 * No long-lived AWS keys ever live in our database. ✅
 *
 * Required Edge Functions (planned, not yet written):
 *   - aws-validate    → calls sts:GetCallerIdentity via assumed role to
 *                       prove the role/external-id pair works
 *   - aws-list-buckets, aws-invoke-lambda, etc. → per-action endpoints
 *
 * Until those edge functions exist, `test()` returns a soft-fail so the
 * UI can show "Configured but not yet validated."
 */

import type { ConnectorAdapter } from '../types';
import { supabase } from '../../supabase';

const PROVIDER_ID = 'aws';

/**
 * Generate a random external ID — used in the IAM trust policy so cross-
 * account assume-role requests must include this exact string. 32 bytes
 * of base64 → ~43 characters of entropy. Persist this in
 * circle_integration_secrets the moment the user starts the connect flow.
 */
export function generateExternalId(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Last-resort fallback for any RN target without WebCrypto.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // base64url so the value can ride along in URLs / CloudFormation params.
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Validate that role_arn looks like a real AWS role ARN.
 * Format: arn:aws:iam::123456789012:role/RoleName
 * (Permissive — AWS partitions like aws-us-gov, aws-cn are accepted.)
 */
export function isValidRoleArn(arn: string): boolean {
  return /^arn:aws[a-z-]*:iam::\d{12}:role\/[\w+=,.@-]+$/.test(arn.trim());
}

/**
 * Build the CloudFormation template the user pastes into their AWS console
 * to create the role. Returns the template as a string. The user customizes
 * the policy attached based on what they want to expose.
 *
 * @param ucAwsAccountId — Our AWS account ID (where edge fns run from).
 * @param externalId — The per-circle external ID we generated.
 */
export function buildCloudFormationTemplate(ucAwsAccountId: string, externalId: string): string {
  return `AWSTemplateFormatVersion: '2010-09-09'
Description: 'Cross-account IAM role for Underground Circle'

Parameters:
  RoleName:
    Type: String
    Default: UndergroundCircleAccess
    Description: 'Name for the IAM role'

Resources:
  UndergroundCircleRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Ref RoleName
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              AWS: 'arn:aws:iam::${ucAwsAccountId}:root'
            Action: 'sts:AssumeRole'
            Condition:
              StringEquals:
                'sts:ExternalId': '${externalId}'
      ManagedPolicyArns:
        # Replace with the minimum set of policies you actually want UC to use.
        # Examples:
        #   arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
        #   arn:aws:iam::aws:policy/AWSLambda_ReadOnlyAccess
        - arn:aws:iam::aws:policy/ReadOnlyAccess

Outputs:
  RoleArn:
    Description: 'Paste this back into Underground Circle'
    Value: !GetAtt UndergroundCircleRole.Arn
`;
}

/**
 * Persist the connection details. Call once after the user pastes their role
 * ARN. Stores role_arn + external_id in circle_integration_secrets (encrypted
 * at rest by Supabase) and creates the parent circle_integrations row.
 */
export async function saveAwsConnection(opts: {
  circleId: string;
  roleArn: string;
  externalId: string;
  region?: string;
  label?: string;
}): Promise<{ ok: boolean; error?: string; integrationId?: string }> {
  const { circleId, roleArn, externalId, region = 'us-east-1', label = 'default' } = opts;

  if (!isValidRoleArn(roleArn)) {
    return { ok: false, error: 'Role ARN looks invalid. Format: arn:aws:iam::123456789012:role/RoleName' };
  }

  const { data: integration, error: createErr } = await supabase
    .from('circle_integrations')
    .upsert({
      circle_id: circleId,
      provider: PROVIDER_ID,
      label,
      status: 'connected',
      display_name: `AWS (${region})`,
      description: `Cross-account access to ${roleArn.split(':')[4]}`,
      metadata: { region, role_arn: roleArn },
      capability_flags: ['storage', 'read_data', 'write_data'],
    }, { onConflict: 'circle_id,provider,label' })
    .select('id')
    .single();

  if (createErr || !integration) {
    return { ok: false, error: createErr?.message || 'Failed to create integration row' };
  }

  // Store the external ID encrypted. The role ARN is in metadata (not secret —
  // it's not an access credential, just an identifier). The external ID IS
  // the secret because anyone with it + our AWS account ID can theoretically
  // probe whether they can assume the role.
  const { error: secretErr } = await supabase
    .from('circle_integration_secrets')
    .upsert({
      integration_id: integration.id,
      key: 'external_id',
      value_encrypted: externalId, // Supabase encrypts at rest; for application-level encryption add a wrapper here.
    }, { onConflict: 'integration_id,key' });

  if (secretErr) {
    return { ok: false, error: `Saved integration but failed to store external ID: ${secretErr.message}` };
  }

  return { ok: true, integrationId: integration.id };
}

/**
 * The runtime adapter — invoked by the connector framework to test/use the
 * connection. The `test()` method calls our planned `aws-validate` edge fn
 * which executes sts:GetCallerIdentity through the assumed role.
 */
export const awsConnector: ConnectorAdapter = {
  providerId: PROVIDER_ID,

  async test(secrets) {
    if (!secrets.role_arn || !secrets.external_id) {
      return { ok: false, error: 'Missing role_arn or external_id' };
    }
    try {
      const { data, error } = await supabase.functions.invoke('aws-validate', {
        body: { roleArn: secrets.role_arn, externalId: secrets.external_id },
      });
      if (error) {
        // Edge function not deployed yet → soft-fail with an informative msg
        // instead of pretending the connection works.
        return { ok: false, error: `aws-validate edge function not reachable: ${error.message}` };
      }
      if (data?.error) return { ok: false, error: data.error };
      return { ok: data?.ok === true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown failure' };
    }
  },

  listActions() {
    // Surface the actions an AWS-connected automation can take. Each one
    // maps to an edge function call. Keep the list small and concrete —
    // these are the verbs users will see in the automation builder.
    return [
      { id: 's3.list_buckets', label: 'S3: List buckets', description: 'List all S3 buckets in the connected account' },
      { id: 's3.put_object', label: 'S3: Upload file', description: 'Upload a file to a specified S3 bucket' },
      { id: 's3.get_object', label: 'S3: Download file', description: 'Read an object from S3' },
      { id: 'lambda.invoke', label: 'Lambda: Invoke function', description: 'Trigger a Lambda function with a payload' },
      { id: 'sns.publish', label: 'SNS: Publish message', description: 'Send a message to an SNS topic' },
      { id: 'sqs.send_message', label: 'SQS: Send message', description: 'Queue a message in SQS' },
      { id: 'cloudwatch.log_event', label: 'CloudWatch: Log event', description: 'Write a custom log event' },
    ];
  },

  async executeAction(actionId, params, secrets) {
    if (!secrets.role_arn || !secrets.external_id) {
      return { ok: false, error: 'AWS connection is not configured.' };
    }
    try {
      const { data, error } = await supabase.functions.invoke('aws-action', {
        body: {
          actionId,
          params,
          roleArn: secrets.role_arn,
          externalId: secrets.external_id,
        },
      });
      if (error) {
        return { ok: false, error: `aws-action invoke failed: ${error.message}` };
      }
      if (data?.error) return { ok: false, error: data.error };
      return { ok: true, result: data?.result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown failure' };
    }
  },
};
