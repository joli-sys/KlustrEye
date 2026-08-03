import { Github } from "lucide-react";
import { externalLinkHandler } from "@/lib/open-external";
import { useToast } from "@/components/ui/toast";

export function Footer() {
  const { addToast } = useToast();
  const openFailed = (description: string) =>
    addToast({ title: "Could not open the link", description, variant: "destructive" });

  return (
    <footer className="border-t mt-auto py-4 px-8">
      <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
        <span>KlustrEye v{process.env.APP_VERSION}</span>
        <div className="flex items-center gap-4">
          <a
            href="https://o-li.cz"
            target="_blank"
            rel="noopener noreferrer"
            onClick={externalLinkHandler("https://o-li.cz", openFailed)}
            className="hover:text-foreground transition-colors"
          >
            o-li.cz
          </a>
          <a
            href="https://github.com/joli-sys/KlustrEye"
            target="_blank"
            rel="noopener noreferrer"
            onClick={externalLinkHandler(
              "https://github.com/joli-sys/KlustrEye",
              openFailed
            )}
            className="hover:text-foreground transition-colors"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}
