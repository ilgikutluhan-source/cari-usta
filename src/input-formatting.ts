import {
  formatInputValueAndCaret,
  formatMoneyInput,
  ungroupMoneyInput,
  formatTurkishPhoneInput,
} from './models';

export type CaretFormatter = (raw: string, caret: number) => { value: string; caret: number };

export const formatMoneyInputWithCaret: CaretFormatter = (raw, caret) =>
  formatInputValueAndCaret(raw, caret, formatMoneyInput);

export const ungroupMoneyInputWithCaret: CaretFormatter = (raw, caret) =>
  formatInputValueAndCaret(raw, caret, ungroupMoneyInput);

export const formatTurkishPhoneInputWithCaret: CaretFormatter = (raw, caret) => {
  const digits = raw.replace(/\D/g, '');
  const hasCountryPrefix = raw.trim().startsWith('+')
    || digits.startsWith('0090')
    || (digits.startsWith('90') && digits.length > 10);
  const leadingDigitOffset = digits.length > 0 && !hasCountryPrefix && !digits.startsWith('0') ? 1 : 0;
  return formatInputValueAndCaret(raw, caret, formatTurkishPhoneInput, leadingDigitOffset);
};

export function applyInputFormatter(
  input: HTMLInputElement,
  formatter: CaretFormatter,
  setValue: (value: string) => void,
): void {
  const result = formatter(input.value, input.selectionStart ?? input.value.length);
  setValue(result.value);
  requestAnimationFrame(() => {
    try {
      input.setSelectionRange(result.caret, result.caret);
    } catch {
      // Some browser input modes do not support selection ranges; formatting still succeeds.
    }
  });
}
