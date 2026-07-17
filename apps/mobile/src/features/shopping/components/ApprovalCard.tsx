import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton, Card } from '@/components';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { PendingAction } from '../types';
import { ChoiceChip, LabelledInput } from './ShoppingControls';

interface ApprovalCardProps {
  action: Exclude<PendingAction, { type: 'handoff' }>;
  busy: boolean;
  onClarification: (answers: Record<string, string>) => void;
  onDomains: (domains: string[]) => void;
  onAddress: () => void;
  onSeatHold: () => void;
}

export function ApprovalCard({
  action,
  busy,
  onClarification,
  onDomains,
  onAddress,
  onSeatHold,
}: ApprovalCardProps) {
  const { theme } = useTheme();
  const { t, textDirection, rowDirection } = useLocalization();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);

  useEffect(() => {
    setAnswers({});
    setSelectedDomains([]);
  }, [action.requestId]);

  const missingRequiredAnswer = useMemo(
    () =>
      action.type === 'clarification' &&
      action.questions.some(
        (question) => question.required && !answers[question.id]?.trim(),
      ),
    [action, answers],
  );

  if (action.type === 'clarification') {
    return (
      <Card>
        <Text
          style={[styles.title, textDirection, { color: theme.colors.text }]}
        >
          {t('clarificationRequired')}
        </Text>
        <View style={styles.fields}>
          {action.questions.map((question) => (
            <LabelledInput
              key={question.id}
              label={`${question.prompt}${question.required ? ' *' : ''}`}
              onChangeText={(value) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: value,
                }))
              }
              value={answers[question.id] ?? ''}
            />
          ))}
        </View>
        <AppButton
          disabled={busy || missingRequiredAnswer}
          label={t(busy ? 'approving' : 'submitAnswers')}
          onPress={() =>
            onClarification(
              Object.fromEntries(
                Object.entries(answers)
                  .map(([key, value]) => [key, value.trim()])
                  .filter(([, value]) => Boolean(value)),
              ),
            )
          }
        />
      </Card>
    );
  }

  if (action.type === 'domain_approval') {
    return (
      <Card>
        <Text
          style={[styles.title, textDirection, { color: theme.colors.text }]}
        >
          {t('merchantApproval')}
        </Text>
        <Text
          style={[styles.body, textDirection, { color: theme.colors.muted }]}
        >
          {t('merchantApprovalBody')}
        </Text>
        <View style={[styles.chips, rowDirection]}>
          {action.candidates.map((merchant) => {
            const selected = selectedDomains.includes(merchant.domain);
            return (
              <ChoiceChip
                key={merchant.id}
                label={`${merchant.name} · ${merchant.domain}`}
                onPress={() =>
                  setSelectedDomains((current) =>
                    selected
                      ? current.filter((domain) => domain !== merchant.domain)
                      : [...current, merchant.domain],
                  )
                }
                selected={selected}
              />
            );
          })}
        </View>
        <AppButton
          disabled={busy || selectedDomains.length === 0}
          label={t(busy ? 'approving' : 'approveSelected')}
          onPress={() => onDomains(selectedDomains)}
        />
      </Card>
    );
  }

  if (action.type === 'address_consent') {
    return (
      <Card>
        <Text
          style={[styles.title, textDirection, { color: theme.colors.text }]}
        >
          {t('addressConsent')}
        </Text>
        <Text
          style={[
            styles.consentPrefix,
            textDirection,
            { color: theme.colors.warning },
          ]}
        >
          {t('addressConsentPrefix')}
        </Text>
        {action.merchantDomains.map((domain) => (
          <Text
            key={domain}
            style={[
              styles.domain,
              textDirection,
              { color: theme.colors.primary },
            ]}
          >
            {domain}
          </Text>
        ))}
        <Text
          style={[styles.body, textDirection, { color: theme.colors.muted }]}
        >
          {t('addressFieldsShared')}: {action.fields.join(', ')}
        </Text>
        <Text
          style={[styles.body, textDirection, { color: theme.colors.muted }]}
        >
          {t('addressConsentBody')}
        </Text>
        <AppButton
          disabled={busy}
          label={t(busy ? 'approving' : 'shareAddress')}
          onPress={onAddress}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Text style={[styles.title, textDirection, { color: theme.colors.text }]}>
        {t('seatHoldApproval')}
      </Text>
      <Text
        style={[styles.domain, textDirection, { color: theme.colors.primary }]}
      >
        {action.merchantDomain}
      </Text>
      <Text style={[styles.body, textDirection, { color: theme.colors.muted }]}>
        {t('seatHoldBody')}
      </Text>
      {action.holdDurationSeconds ? (
        <Text
          style={[styles.body, textDirection, { color: theme.colors.warning }]}
        >
          {t('seatHoldDuration')}: {action.holdDurationSeconds}s
        </Text>
      ) : null}
      <AppButton
        disabled={busy}
        label={t(busy ? 'approving' : 'approveSeatHold')}
        onPress={onSeatHold}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  fields: { gap: 12 },
  chips: { flexWrap: 'wrap', gap: 8 },
  consentPrefix: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  domain: { fontSize: 15, lineHeight: 21, fontWeight: '900' },
});
