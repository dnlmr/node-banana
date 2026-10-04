import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopUpdateNotice } from '../DesktopUpdateNotice';
import type { DesktopUpdateState } from '@/types/desktop';

type Listener = (state: DesktopUpdateState) => void;

function installBridge(initial: DesktopUpdateState) {
  const listeners = new Set<Listener>();
  const updates = {
    state: vi.fn(async () => initial),
    check: vi.fn(async () => initial),
    download: vi.fn(async () => initial),
    install: vi.fn(async () => initial),
    skip: vi.fn(async () => initial),
    dismiss: vi.fn(async () => initial),
    onChange: (listener: Listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  Object.defineProperty(window, 'nodeBananaDesktop', { configurable: true, value: { updates } });
  return { updates, emit: (state: DesktopUpdateState) => act(() => { listeners.forEach(listener => listener(state)); }) };
}

afterEach(() => {
  delete (window as { nodeBananaDesktop?: unknown }).nodeBananaDesktop;
  vi.useRealTimers();
});

it('renders nothing in the browser, in development, or while there is nothing to say', async () => {
  const { container } = render(<DesktopUpdateNotice />);
  expect(container).toBeEmptyDOMElement();
  const { emit } = installBridge({ supported: false, status: 'idle', currentVersion: '1.10.0' });
  const { container: desktop } = render(<DesktopUpdateNotice />);
  await act(async () => {});
  expect(desktop).toBeEmptyDOMElement();
  emit({ supported: true, status: 'checking', currentVersion: '1.10.0', manual: false });
  expect(desktop).toBeEmptyDOMElement();
  emit({ supported: true, status: 'current', currentVersion: '1.10.0', manual: false });
  expect(desktop).toBeEmptyDOMElement();
});

it('offers an available update, follows the download and asks to restart', async () => {
  const { updates, emit } = installBridge({ supported: true, status: 'available', currentVersion: '1.10.0', version: '1.11.0', url: 'https://github.com/shrimbly/node-banana/releases/tag/v1.11.0' });
  render(<DesktopUpdateNotice />);
  expect(await screen.findByText('Node Banana 1.11.0 is available')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(updates.skip).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }));
  expect(updates.dismiss).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  expect(updates.download).toHaveBeenCalledOnce();

  emit({ supported: true, status: 'downloading', currentVersion: '1.10.0', version: '1.11.0', percent: 42, transferred: 250 * 1024 * 1024, total: 600 * 1024 * 1024 });
  expect(screen.getByText('Downloading 1.11.0')).toBeInTheDocument();
  expect(screen.getByText('42%')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', '42');
  expect(screen.queryByRole('button', { name: 'Dismiss update notice' })).not.toBeInTheDocument();

  emit({ supported: true, status: 'downloaded', currentVersion: '1.10.0', version: '1.11.0' });
  expect(screen.getByText('1.11.0 is ready')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }));
  expect(updates.dismiss).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
  expect(updates.install).toHaveBeenCalledOnce();

  emit({ supported: true, status: 'idle', currentVersion: '1.10.0' });
  expect(screen.queryByTestId('desktop-update-notice')).not.toBeInTheDocument();
});

it('reports a failed install with the installer to fetch by hand, and a failed manual check', async () => {
  const { updates, emit } = installBridge({ supported: true, status: 'error', currentVersion: '1.10.0', version: '1.11.0', url: 'https://github.com/shrimbly/node-banana/releases/tag/v1.11.0', error: 'Could not get code signature for running application' });
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  render(<DesktopUpdateNotice />);
  expect(await screen.findByText('Update failed')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveAttribute('title', 'Could not get code signature for running application');
  fireEvent.click(screen.getByRole('button', { name: 'Get the installer' }));
  expect(open).toHaveBeenCalledWith('https://github.com/shrimbly/node-banana/releases/tag/v1.11.0', '_blank', 'noopener');

  emit({ supported: true, status: 'error', currentVersion: '1.10.0', url: 'https://github.com/shrimbly/node-banana/releases', error: 'net::ERR_INTERNET_DISCONNECTED', manual: true });
  expect(screen.getByText('Couldn’t check for updates')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Get the installer' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }));
  expect(updates.dismiss).toHaveBeenCalledOnce();
});

it('shows a manual check and its "up to date" answer for a moment', async () => {
  vi.useFakeTimers();
  const { updates, emit } = installBridge({ supported: true, status: 'checking', currentVersion: '1.10.0', manual: true });
  render(<DesktopUpdateNotice />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText('Checking for updates…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Dismiss update notice' })).not.toBeInTheDocument();
  emit({ supported: true, status: 'current', currentVersion: '1.10.0', manual: true });
  expect(screen.getByText('Up to date')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(updates.dismiss).toHaveBeenCalledOnce();
});
