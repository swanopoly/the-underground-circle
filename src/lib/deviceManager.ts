/**
 * deviceManager.ts — Local device discovery & control via Claude Code Bridge
 *
 * Provides typed access to printers, 3D printers, serial ports, and network
 * devices connected to the user's local machine. All communication goes through
 * the bridge at localhost:7778.
 */

import { getBridgeUrl } from './bridgeEnvironment';
import { fetchBridgeAuthenticated } from './bridgeAuth';
import { requestLocalFileSessionGrant } from './desktopBridge';

const BRIDGE_PORT = 7778;

function getDeviceBridgeUrl(): string | null {
  return getBridgeUrl(BRIDGE_PORT);
}

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface Printer {
  name: string;
  status: string;
  isDefault: boolean;
}

export interface SerialPort {
  path: string;
  description: string;
}

export interface USBDevice {
  bus: string;
  device: string;
  id: string;
  description: string;
}

export interface NetworkDevice {
  ip: string;
  hostname: string | null;
  mac: string | null;
  services: string[];
}

export interface PrinterService3D {
  type: 'octoprint' | 'klipper' | 'serial';
  url?: string;
  port?: string;
  status: string;
  version?: string;
}

export interface DeviceInventory {
  printers: Printer[];
  serialPorts: SerialPort[];
  usbDevices: USBDevice[];
  networkPrinters: string[];
  timestamp: string;
}

export type DeviceCategory = 'printers' | 'serial' | '3dprinter' | 'network' | 'all';
export type DeviceReadResult<T> = Readonly<{ ok: boolean; data: T | null; error?: string }>;

// ─── Bridge Communication ───────────────────────────────────────────────────────

async function bridgeGet<T>(path: string): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const bridgeUrl = getDeviceBridgeUrl();
  if (!bridgeUrl) return { ok: false, data: null, error: 'Bridge unavailable in this environment' };
  try {
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { ok: false, data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, data: null, error: err?.message || 'Bridge unreachable' };
  }
}

async function bridgePost<T>(
  path: string,
  body: Record<string, any>,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const bridgeUrl = getDeviceBridgeUrl();
  if (!bridgeUrl) return { ok: false, data: null, error: 'Bridge unavailable in this environment' };
  try {
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: data.ok !== false, data, error: data.error };
  } catch (err: any) {
    return { ok: false, data: null, error: err?.message || 'Bridge unreachable' };
  }
}

// ─── Device Discovery ───────────────────────────────────────────────────────────

/** Check if bridge is running and has device support */
export async function checkBridgeHealth(): Promise<boolean> {
  const result = await bridgeGet<{ ok: boolean }>('/health');
  return result.ok && !!result.data?.ok;
}

/** Discover all connected devices (cached 10s on bridge side) */
export async function discoverAllDevices(): Promise<DeviceInventory | null> {
  const result = await discoverAllDevicesResult();
  return result.data;
}

export async function discoverAllDevicesResult(): Promise<DeviceReadResult<DeviceInventory>> {
  return bridgeGet<DeviceInventory>('/devices');
}

/** List printers with status and default */
export async function listPrinters(): Promise<Printer[]> {
  const result = await bridgeGet<{ printers: Printer[] }>('/devices/printers');
  return result.data?.printers || [];
}

/** List serial ports */
export async function listSerialPorts(): Promise<SerialPort[]> {
  const result = await bridgeGet<{ ports: SerialPort[] }>('/devices/serial');
  return result.data?.ports || [];
}

/** Detect 3D printer services */
export async function detect3DPrinters(): Promise<PrinterService3D[]> {
  const result = await detect3DPrintersResult();
  return result.data?.services || [];
}

export async function detect3DPrintersResult(): Promise<DeviceReadResult<{ services: PrinterService3D[] }>> {
  return bridgeGet<{ services: PrinterService3D[] }>('/devices/3dprinter');
}

/** Scan network for devices */
export async function scanNetwork(): Promise<NetworkDevice[]> {
  const result = await scanNetworkResult();
  return result.data?.devices || [];
}

export async function scanNetworkResult(): Promise<DeviceReadResult<{ devices: NetworkDevice[] }>> {
  return bridgeGet<{ devices: NetworkDevice[] }>('/devices/network');
}

// ─── Device Actions ─────────────────────────────────────────────────────────────

/** Print text content */
export async function printText(text: string, options?: { printer?: string; copies?: number }): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const result = await bridgePost<{ ok: boolean; jobId?: string; error?: string }>('/devices/print', {
    text,
    printer: options?.printer,
    copies: options?.copies || 1,
  });
  return { ok: result.ok, jobId: result.data?.jobId, error: result.error };
}

/** Print a file by path */
export async function printFile(filePath: string, options?: { printer?: string; copies?: number }): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const grant = await requestLocalFileSessionGrant({
    roots: [filePath],
    scope: 'read',
    reason: `Print local file ${filePath}`,
  });
  if (!grant.ok || !grant.data?.token) {
    return { ok: false, error: grant.error || 'Local file access grant was not created.' };
  }
  const result = await bridgePost<{ ok: boolean; jobId?: string; error?: string }>('/devices/print', {
    file: filePath,
    printer: options?.printer,
    copies: options?.copies || 1,
  }, { 'X-UC-File-Session-Token': grant.data.token });
  return { ok: result.ok, jobId: result.data?.jobId, error: result.error };
}

/** Send data to a serial port */
export async function sendToSerial(port: string, data: string, baudRate?: number): Promise<{ ok: boolean; error?: string }> {
  const result = await bridgePost<{ ok: boolean }>('/devices/serial/send', {
    port,
    data,
    baudRate: baudRate || 115200,
  });
  return { ok: result.ok, error: result.error };
}

/** Send G-code to a 3D printer */
export async function sendGCode(
  target: 'octoprint' | 'klipper' | 'serial',
  command: string,
  options?: { apiKey?: string; port?: string; serviceUrl?: string }
): Promise<{ ok: boolean; response?: string; error?: string }> {
  const result = await bridgePost<{ ok: boolean; response?: string }>('/devices/3dprinter/command', {
    target,
    command,
    apiKey: options?.apiKey,
    port: options?.port,
    serviceUrl: options?.serviceUrl,
  });
  return { ok: result.ok, response: result.data?.response, error: result.error };
}

// ─── Terminal Command Helpers ───────────────────────────────────────────────────
// These format device commands for use in the OfficeTerminal

export function formatDeviceCommand(action: string, args: Record<string, string> = {}): string {
  switch (action) {
    case 'list':
      return 'devices list';
    case 'printers':
      return 'devices printers';
    case 'print':
      return `devices print ${args.text ? `"${args.text}"` : args.file || ''}${args.printer ? ` --printer ${args.printer}` : ''}`;
    case 'serial':
      return 'devices serial';
    case '3dprinter':
      return 'devices 3dprinter';
    case 'gcode':
      return `devices gcode ${args.target || 'serial'} "${args.command || ''}"`;
    case 'network':
      return 'devices network';
    default:
      return `devices ${action}`;
  }
}

/** Parse a "devices ..." terminal command and execute it */
export async function executeDeviceCommand(commandText: string): Promise<string> {
  const parts = commandText.trim().split(/\s+/);
  // Remove leading "devices" if present
  if (parts[0] === 'devices') parts.shift();

  const sub = parts[0] || 'list';

  switch (sub) {
    case 'list':
    case 'scan':
    case 'discover': {
      const inventory = await discoverAllDevices();
      if (!inventory) return '⚠ Bridge offline — start with: node scripts/claude-bridge.js';
      const lines: string[] = ['┌─ CONNECTED DEVICES ─────────────────────┐'];
      if (inventory.printers.length) {
        lines.push('│ PRINTERS');
        for (const p of inventory.printers) {
          lines.push(`│  ${p.isDefault ? '►' : ' '} ${p.name} — ${p.status}`);
        }
      }
      if (inventory.serialPorts.length) {
        lines.push('│ SERIAL PORTS');
        for (const s of inventory.serialPorts) {
          lines.push(`│   ${s.path} — ${s.description}`);
        }
      }
      if (inventory.usbDevices.length) {
        lines.push(`│ USB DEVICES (${inventory.usbDevices.length})`);
        for (const u of inventory.usbDevices.slice(0, 10)) {
          lines.push(`│   [${u.id}] ${u.description}`);
        }
        if (inventory.usbDevices.length > 10) lines.push(`│   ... and ${inventory.usbDevices.length - 10} more`);
      }
      if (inventory.networkPrinters.length) {
        lines.push('│ NETWORK PRINTERS');
        for (const n of inventory.networkPrinters) {
          lines.push(`│   ${n}`);
        }
      }
      if (!inventory.printers.length && !inventory.serialPorts.length && !inventory.usbDevices.length) {
        lines.push('│ No devices detected');
      }
      lines.push('└─────────────────────────────────────────┘');
      return lines.join('\n');
    }

    case 'printers': {
      const printers = await listPrinters();
      if (!printers.length) return 'No printers found';
      return printers.map(p => `${p.isDefault ? '► ' : '  '}${p.name} — ${p.status}`).join('\n');
    }

    case 'print': {
      const rest = parts.slice(1).join(' ');
      if (!rest) return 'Usage: devices print "text to print" [--printer name]';
      const printerMatch = rest.match(/--printer\s+(\S+)/);
      const printer = printerMatch?.[1];
      const text = rest.replace(/--printer\s+\S+/, '').replace(/^["']|["']$/g, '').trim();
      if (!text) return 'No text provided';
      const result = await printText(text, { printer });
      return result.ok ? `✓ Print job queued${result.jobId ? ` (${result.jobId})` : ''}` : `✗ Print failed: ${result.error}`;
    }

    case 'serial':
    case 'ports': {
      const ports = await listSerialPorts();
      if (!ports.length) return 'No serial ports found';
      return ports.map(p => `${p.path} — ${p.description}`).join('\n');
    }

    case '3dprinter':
    case '3d': {
      const services = await detect3DPrinters();
      if (!services.length) return 'No 3D printer services detected\nSupported: OctoPrint, Klipper/Moonraker, USB serial';
      return services.map(s => `[${s.type.toUpperCase()}] ${s.url || s.port || '?'} — ${s.status}${s.version ? ` (v${s.version})` : ''}`).join('\n');
    }

    case 'gcode': {
      return 'G-code requires an exact detected target and a separate hardware confirmation. Open Backpack → Devices to review and run the command.';
    }

    case 'network':
    case 'scan-network': {
      const devices = await scanNetwork();
      if (!devices.length) return 'No network devices found';
      return devices.map(d => `${d.ip}${d.hostname ? ` (${d.hostname})` : ''}${d.mac ? ` [${d.mac}]` : ''}`).join('\n');
    }

    case 'help':
    default:
      return [
        '┌─ DEVICE COMMANDS ──────────────────────────────┐',
        '│ devices list        — Scan all connected devices│',
        '│ devices printers    — List printers              │',
        '│ devices print "txt" — Print text to default      │',
        '│ devices serial      — List serial/COM ports      │',
        '│ devices 3d          — Detect 3D printer services │',
        '│ devices gcode       — Open Devices for safe review│',
        '│ devices network     — Scan local network         │',
        '└──────────────────────────────────────────────────┘',
      ].join('\n');
  }
}
