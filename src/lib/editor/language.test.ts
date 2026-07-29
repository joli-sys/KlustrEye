import { describe, it, expect } from "vitest";
import { languageForPath } from "@/lib/editor/language";

describe("languageForPath", () => {
  it("maps Terraform sources to hcl", () => {
    expect(languageForPath("main.tf")).toBe("hcl");
    expect(languageForPath("infra/prod.tfvars")).toBe("hcl");
    expect(languageForPath("infra/.terraform.lock.hcl")).toBe("hcl");
  });

  it("maps Terraform state to json — it is JSON, not HCL", () => {
    expect(languageForPath("terraform.tfstate")).toBe("json");
  });

  it("maps plain YAML to yaml", () => {
    expect(languageForPath("ci.yaml")).toBe("yaml");
    expect(languageForPath("ci.yml")).toBe("yaml");
  });

  it("treats YAML under a templates/ directory as a Helm template", () => {
    expect(languageForPath("templates/deployment.yaml")).toBe("helm");
    expect(languageForPath("charts/api/templates/service.yml")).toBe("helm");
  });

  it("treats .tpl as a Helm template wherever it lives", () => {
    expect(languageForPath("_helpers.tpl")).toBe("helm");
    expect(languageForPath("charts/api/templates/_helpers.tpl")).toBe("helm");
  });

  it("leaves chart-root YAML as plain yaml", () => {
    // The whole point of requiring a `templates/` segment: these two carry no
    // Go template directives and must not get the helm grammar.
    expect(languageForPath("values.yaml")).toBe("yaml");
    expect(languageForPath("Chart.yaml")).toBe("yaml");
    expect(languageForPath("charts/api/values.yaml")).toBe("yaml");
    expect(languageForPath("charts/api/Chart.yaml")).toBe("yaml");
  });

  it("does not mistake a file named `templates` for the directory", () => {
    expect(languageForPath("templates.yaml")).toBe("yaml");
  });

  it("falls back to plaintext for unknown and extensionless names", () => {
    expect(languageForPath("notes.wibble")).toBe("plaintext");
    expect(languageForPath("LICENSE")).toBe("plaintext");
    expect(languageForPath(".gitignore")).toBe("plaintext");
  });

  it("keeps the pre-existing mappings", () => {
    expect(languageForPath("src/App.tsx")).toBe("typescript");
    expect(languageForPath("Cargo.toml")).toBe("ini");
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
  });
});
