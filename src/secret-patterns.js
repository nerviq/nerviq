const EMBEDDED_SECRET_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAZURE(?:_[A-Z0-9]+){0,4}_(?:API_)?KEY\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{20,}['"]?/g,
  /\bDefaultEndpointsProtocol=https;AccountName=[^;\s]+;AccountKey=[A-Za-z0-9+/=]{20,};EndpointSuffix=core\.windows\.net\b/gi,
  /\bEndpoint=sb:\/\/[^\s;]+;SharedAccessKeyName=[^;\s]+;SharedAccessKey=[A-Za-z0-9+/=]{20,}\b/gi,
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp):\/\/[^:\s/]+:[^@\s]{4,}@[^/\s]+(?:\/[^\s'"]*)?/gi,
  /\b(?:Server|Host|Data Source)\s*=\s*[^;\n]+;[^\n]*(?:Password|Pwd)\s*=\s*[^;\n]{4,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /-----BEGIN (?:OPENSSH|RSA|DSA|EC) PRIVATE KEY-----[\s\S]{40,}?-----END (?:OPENSSH|RSA|DSA|EC) PRIVATE KEY-----/g,
  /-----BEGIN PRIVATE KEY-----[\s\S]{40,}?-----END PRIVATE KEY-----/g,
  /"type"\s*:\s*"service_account"[\s\S]{0,1200}?"client_email"\s*:\s*"[^\"]+@[^"]*gserviceaccount\.com"[\s\S]{0,1200}?"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----[\s\S]{20,}?-----END PRIVATE KEY-----\\n?"/g,
];

function containsEmbeddedSecret(text = '') {
  return EMBEDDED_SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function redactEmbeddedSecrets(text = '') {
  let output = text;
  for (const pattern of EMBEDDED_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, '[REDACTED_SECRET]');
  }
  return output;
}

module.exports = {
  EMBEDDED_SECRET_PATTERNS,
  containsEmbeddedSecret,
  redactEmbeddedSecrets,
};
