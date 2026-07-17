const SENSITIVE_FIELD =
  /(recipientName|mobileNumber|governorate|cityOrArea|street|building|floor|apartment|landmark|postalCode|authorization|cookie|token|secret|screenshot|image_url|viewerUrl|viewer_url)/i;

export function redactPhase1LogLine(line, secretValues = []) {
  let redacted = String(line);
  for (const secret of secretValues.filter((value) => value?.length >= 4)) {
    redacted = redacted.replaceAll(secret, '[REDACTED]');
  }
  redacted = redacted
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]')
    .replace(
      /([?&](?:token|authorization|cookie|secret)[^=]*=)[^&#\s]*/gi,
      '$1[REDACTED]',
    )
    .replace(
      /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi,
      '[REDACTED_IMAGE]',
    )
    .replace(/(\/viewer\/)[^\s"']+/gi, '$1[REDACTED]');

  try {
    const value = JSON.parse(redacted);
    return JSON.stringify(redactStructured(value));
  } catch {
    return redacted.replace(
      /("?(?:recipientName|mobileNumber|governorate|cityOrArea|street|building|floor|apartment|landmark|postalCode|screenshot|image_url|viewerUrl|viewer_url)"?\s*[:=]\s*)[^,}\s]+/gi,
      '$1[REDACTED]',
    );
  }
}

function redactStructured(value) {
  if (Array.isArray(value)) return value.map(redactStructured);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_FIELD.test(key) ? '[REDACTED]' : redactStructured(item),
    ]),
  );
}
