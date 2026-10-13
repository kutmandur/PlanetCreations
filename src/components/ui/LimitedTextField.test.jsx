import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LimitedTextField from './LimitedTextField';
import HighlightableTextarea from './HighlightableTextarea';

afterEach(cleanup);

it('keeps the label stable and exposes existing help plus a persistent count', () => {
    const { rerender } = render(<><p id="help">Explain your change.</p><label>Reason<LimitedTextField as="textarea" value="abc" onChange={() => {}} maxLength={5} aria-describedby="help" /></label></>);
    const field = screen.getByRole('textbox', { name: 'Reason' });
    expect(field).toHaveAttribute('maxlength', '5');
    expect(field).toHaveAccessibleDescription('Explain your change. 3 / 5 characters');
    rerender(<label>Reason<LimitedTextField as="textarea" value="abcde" onChange={() => {}} maxLength={5} /></label>);
    expect(screen.getByRole('textbox', { name: 'Reason' })).toBeValid();
    expect(screen.getByText('5 / 5 characters')).toBeVisible();
});

it('preserves a loaded over-limit value and blocks native form validity until corrected', () => {
    const { rerender } = render(<LimitedTextField aria-label="Title" value="abcdef" onChange={() => {}} maxLength={5} />);
    expect(screen.getByRole('textbox')).toHaveValue('abcdef');
    expect(screen.getByRole('textbox')).toBeInvalid();
    expect(screen.getByText(/shorten before saving/)).toBeVisible();
    rerender(<LimitedTextField aria-label="Title" value="abc" onChange={() => {}} maxLength={5} />);
    expect(screen.getByRole('textbox')).toBeValid();
});

it('tracks uncontrolled inline edits and blur resets without dropping handlers', () => {
    const onChange = vi.fn();
    render(<LimitedTextField aria-label="Area" defaultValue="Old" maxLength={60} onChange={onChange} onBlur={event => { event.currentTarget.value = 'Restored'; }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New area' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText('8 / 60 characters')).toBeVisible();
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.getByRole('textbox')).toHaveValue('Restored');
    expect(screen.getByText('8 / 60 characters')).toBeVisible();
});

it('forwards limits and accessible help to the highlighted textarea and counts UTF-16 consistently', () => {
    render(<LimitedTextField as={HighlightableTextarea} aria-label="Description" value="😀" onChange={() => {}} blacklist={[]} maxLength={5} />);
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute('maxlength', '5');
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('2 / 5 characters');
});
