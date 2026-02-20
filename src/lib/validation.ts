// ─── Validation Results ──────────────────────────────────────────────────────

type ValidationResult = { isValid: boolean; error?: string };

// ─── Length Limits ───────────────────────────────────────────────────────────

export const LENGTH_LIMITS = {
  username: { min: 3, max: 20 },
  email: { max: 254 },
  password: { min: 8, max: 128 },
  displayName: { min: 1, max: 50 },
  content: { max: 500 },
  taskTitle: { min: 3, max: 200 },
  circleName: { min: 2, max: 50 },
};

// ─── Sanitization ────────────────────────────────────────────────────────────

export function sanitizeText(input: string, maxLength = 500): string {
  return input.trim().slice(0, maxLength);
}

export function sanitizeString(input: string, maxLength = 500): string {
  return input.trim().slice(0, maxLength);
}

// ─── Username ────────────────────────────────────────────────────────────────

export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

export function validateUsername(username: string): ValidationResult {
  const trimmed = username.trim();
  if (!trimmed) return { isValid: false, error: 'Username is required' };
  if (trimmed.length < LENGTH_LIMITS.username.min) return { isValid: false, error: 'Username must be at least 3 characters' };
  if (trimmed.length > LENGTH_LIMITS.username.max) return { isValid: false, error: 'Username must be 20 characters or less' };
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return { isValid: false, error: 'Username: letters, numbers, and underscores only' };
  return { isValid: true };
}

// ─── Email ───────────────────────────────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateEmail(email: string): ValidationResult {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { isValid: false, error: 'Email is required' };
  if (!isValidEmail(trimmed)) return { isValid: false, error: 'Invalid email format' };
  return { isValid: true };
}

// ─── Password ────────────────────────────────────────────────────────────────

export function isStrongPassword(password: string): boolean {
  return password.length >= 8;
}

export function validatePassword(password: string): ValidationResult {
  if (!password) return { isValid: false, error: 'Password is required' };
  if (password.length < 8) return { isValid: false, error: 'Password must be at least 8 characters' };
  if (!/(?=.*[a-z])/.test(password)) return { isValid: false, error: 'Password needs a lowercase letter' };
  if (!/(?=.*[A-Z])/.test(password)) return { isValid: false, error: 'Password needs an uppercase letter' };
  if (!/(?=.*\d)/.test(password)) return { isValid: false, error: 'Password needs a number' };
  return { isValid: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidDisplayName(displayName: string): boolean {
  const trimmed = displayName.trim();
  return trimmed.length >= 1 && trimmed.length <= 50;
}

export function isValidContent(content: string, maxLength = 500): boolean {
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength;
}

export function isValidTaskTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length >= 3 && trimmed.length <= 200;
}

export function isValidCircleName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 50;
}
