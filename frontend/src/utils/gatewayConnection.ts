export type GatewayTarget = 'host' | 'compose' | 'docker-host';

export interface GatewayConnectionOption {
  target: GatewayTarget;
  label: string;
  url: string;
  hint: string;
}

const GATEWAY_PORT = 4101;

function getHostname(): string {
  if (typeof window === 'undefined') {
    return 'localhost';
  }
  return window.location.hostname;
}

export function getBrowserGatewayBaseUrl(): string {
  const hostname = getHostname();
  const isIpv6 = hostname.includes(':') && !hostname.startsWith('[');
  const hostPart = isIpv6 ? `[${hostname}]` : hostname;
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${hostPart}:${GATEWAY_PORT}/v1`;
}

export function getGatewayConnectionOptions(): GatewayConnectionOption[] {
  const localUrl = getBrowserGatewayBaseUrl();
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
      url: `http://app:${GATEWAY_PORT}/v1`,
      hint: 'Use this when your app is another service in the same Docker Compose network.'
    },
    {
      target: 'docker-host',
      label: 'Another Docker container',
      url: `http://host.docker.internal:${GATEWAY_PORT}/v1`,
      hint: 'Use this from a Docker container outside the SLIR Compose project.'
    }
  ];
}

export type GatewayConfig = {
  publicBaseUrl: string | null;
  gatewayPort: number;
};

let configPromise: Promise<{ publicBaseUrl: string | null; gatewayPort: number }> | null = null;

export async function fetchGatewayConfig(): Promise<GatewayConfig> {
  if (!configPromise) {
    configPromise = fetch('/api/config')
      .then((res) => (res.ok ? res.json() : { publicBaseUrl: null, gatewayPort: 4101 }))
      .catch(() => ({ publicBaseUrl: null, gatewayPort: 4101 }));
  }
  return configPromise;
}