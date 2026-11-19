export type GatewayTarget = 'host' | 'compose' | 'docker-host';

export interface GatewayConnectionOption {
  target: GatewayTarget;
  label: string;
  url: string;
  hint: string;
}

export const DEFAULT_GATEWAY_PORT = 4101;

function getHostname(): string {
  if (typeof window === 'undefined') {
    return 'localhost';
  }
  return window.location.hostname;
}

export function getBrowserGatewayBaseUrl(port = DEFAULT_GATEWAY_PORT): string {
  const hostname = getHostname();
  const isIpv6 = hostname.includes(':') && !hostname.startsWith('[');
  const hostPart = isIpv6 ? `[${hostname}]` : hostname;
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${hostPart}:${port}/v1`;
}

export function getGatewayConnectionOptions(port = DEFAULT_GATEWAY_PORT): GatewayConnectionOption[] {
  const localUrl = getBrowserGatewayBaseUrl(port);
  return [
    {
      target: 'host',
      label: 'This machine / IDE',
      url: localUrl,
      hint: 'Use this when your app runs directly on this machine or in your IDE.'
    },
    {
      target: 'compose',
      label: 'Same Docker Compose project',
      url: `http://app:${port}/v1`,
      hint: 'Use this when your app is another service in the same Docker Compose network.'
    },
    {
      target: 'docker-host',
      label: 'Another Docker container',
      url: `http://host.docker.internal:${port}/v1`,
      hint: 'Use this from a Docker container outside the SLIR Compose project.'
    }
  ];
}

export type GatewayConfig = {
  publicBaseUrl: string | null;
  gatewayPort: number;
};

export async function fetchGatewayConfig(): Promise<GatewayConfig> {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return { publicBaseUrl: null, gatewayPort: DEFAULT_GATEWAY_PORT };
    const data = await res.json();
    const port = Number(data.gatewayPort);
    return {
      publicBaseUrl: typeof data.publicBaseUrl === 'string' ? data.publicBaseUrl : null,
      gatewayPort: Number.isInteger(port) && port > 0 ? port : DEFAULT_GATEWAY_PORT
    };
  } catch {
    return { publicBaseUrl: null, gatewayPort: DEFAULT_GATEWAY_PORT };
  }
}
