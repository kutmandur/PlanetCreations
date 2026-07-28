import { render, screen } from '@testing-library/react';
import App from './App';

vi.mock('./firebase/config', () => ({
  auth: null,
  db: null,
  isConfigured: false,
}));

test('renders a clear warning when Firebase configuration is missing', () => {
  render(<App />);
  expect(screen.getByRole('heading', {
    name: /firebase configuration missing/i,
  })).toBeInTheDocument();
});
