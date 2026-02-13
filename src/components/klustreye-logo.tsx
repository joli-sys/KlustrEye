import Image from "next/image";
import { cn } from "@/lib/utils";

const sizes = {
  sm: { width: 100, height: 75 },
  md: { width: 130, height: 97 },
  lg: { width: 180, height: 134 },
};

interface KlustrEyeLogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function KlustrEyeLogo({
  size = "md",
  className,
}: KlustrEyeLogoProps) {
  const { width, height } = sizes[size];

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <Image
        src="/KlustrEye_logo.png"
        alt="KlustrEye"
        width={width}
        height={height}
        className="shrink-0"
      />
    </div>
  );
}
