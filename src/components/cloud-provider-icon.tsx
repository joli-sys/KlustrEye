import { type CloudProvider, PROVIDER_LABELS } from "@/lib/k8s/provider";

interface CloudProviderIconProps {
  provider: CloudProvider;
  size?: number;
  className?: string;
}

function AwsIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#232F3E"/>
      <path d="M7.2 14.2c2.4 1.5 5.6 1.8 9.2.3" stroke="#FF9900" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <path d="M17.4 13.6l.6 1.4" stroke="#FF9900" strokeWidth="1.6" strokeLinecap="round"/>
      <text x="12" y="11.5" textAnchor="middle" fill="white" fontSize="5.5" fontWeight="bold" fontFamily="Arial, sans-serif">aws</text>
    </svg>
  );
}

function GcpIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M15.547 7.93l1.482-1.483.078-.63A8.462 8.462 0 0 0 3.49 9.455l.543-.07 2.963-.49.228-.233a4.498 4.498 0 0 1 8.323-.733z" fill="#EA4335"/>
      <path d="M19.262 9.456a8.484 8.484 0 0 0-2.56-4.139l-2.073 2.073a4.489 4.489 0 0 1 1.648 3.563v.449a2.246 2.246 0 0 1 0 4.49H12l-.449.45v2.694l.449.449h4.277a5.21 5.21 0 0 0 2.985-9.529z" fill="#4285F4"/>
      <path d="M7.723 19.485h4.278v-3.593H7.723a2.228 2.228 0 0 1-.926-.202l-.638.196-1.49 1.482-.157.625a5.18 5.18 0 0 0 3.211 1.492z" fill="#34A853"/>
      <path d="M7.723 9.02A5.211 5.211 0 0 0 4.512 18.5l2.29-2.29a2.245 2.245 0 1 1 2.974-3.37l2.29-2.29A5.202 5.202 0 0 0 7.723 9.02z" fill="#FBBC05"/>
    </svg>
  );
}

function AzureIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M9.085 3.68h5.028L8.806 20.434a.843.843 0 0 1-.799.566H3.592a.843.843 0 0 1-.795-1.12L8.286 4.246a.843.843 0 0 1 .799-.566z" fill="#0078D4"/>
      <path d="M16.468 14.583H8.378a.384.384 0 0 0-.262.665l5.206 4.866a.847.847 0 0 0 .576.226h4.716l-2.146-5.757z" fill="#0078D4" opacity="0.7"/>
      <path d="M9.085 3.68a.838.838 0 0 0-.797.576L2.804 19.876a.843.843 0 0 0 .788 1.124h4.578a.906.906 0 0 0 .646-.576l1.05-3.072 3.674 3.43a.862.862 0 0 0 .545.218h4.698l-2.1-5.417-6.315.001L14.11 3.68z" fill="#0078D4"/>
      <path d="M15.71 4.246a.843.843 0 0 0-.798-.566H9.165a.843.843 0 0 1 .799.566l5.489 15.634a.843.843 0 0 1-.795 1.12h5.747a.843.843 0 0 0 .795-1.12z" fill="#0078D4" opacity="0.7"/>
    </svg>
  );
}

function KubernetesIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 1.5a1.34 1.34 0 0 0-.56.13L4.16 5.2a1.34 1.34 0 0 0-.66.9l-1.52 8a1.34 1.34 0 0 0 .18 1.04l5.04 6.4a1.34 1.34 0 0 0 1.06.46h7.48a1.34 1.34 0 0 0 1.06-.46l5.04-6.4a1.34 1.34 0 0 0 .18-1.04l-1.52-8a1.34 1.34 0 0 0-.66-.9L12.56 1.63A1.34 1.34 0 0 0 12 1.5z" fill="#326CE5"/>
      <path d="M12 4.5a.75.75 0 0 0-.75.75v.1l-.44 3.15-.02.14a.38.38 0 0 1-.3.3l-.14.02-3.08.58h-.07a.75.75 0 0 0-.46 1.18l.07.08 2.26 2.16.1.1a.38.38 0 0 1 .08.4l-.05.13-1.12 2.98-.04.1a.75.75 0 0 0 1.04.9l.1-.05 2.88-1.36.13-.06a.38.38 0 0 1 .35 0l.13.06 2.88 1.36.1.05a.75.75 0 0 0 1.04-.9l-.04-.1-1.12-2.98-.05-.13a.38.38 0 0 1 .08-.4l.1-.1 2.26-2.16.07-.08a.75.75 0 0 0-.46-1.18h-.07l-3.08-.58-.14-.02a.38.38 0 0 1-.3-.3l-.02-.14-.44-3.14v-.1A.75.75 0 0 0 12 4.5z" fill="white"/>
    </svg>
  );
}

export function CloudProviderIcon({ provider, size = 20, className }: CloudProviderIconProps) {
  const label = PROVIDER_LABELS[provider];
  const iconProps = { size, className };

  return (
    <span title={label} className="inline-flex">
      {provider === "eks" && <AwsIcon {...iconProps} />}
      {provider === "gke" && <GcpIcon {...iconProps} />}
      {provider === "aks" && <AzureIcon {...iconProps} />}
      {provider === "kubernetes" && <KubernetesIcon {...iconProps} />}
    </span>
  );
}
