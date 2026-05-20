import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { BashDispatchRenderer } from "../BashDispatchRenderer.js";
import type { InteractiveRendererProps } from "@blackbelt-technology/dashboard-plugin-runtime";

afterEach(() => cleanup());

function makeProps(
  componentProps: Record<string, unknown>,
  status: InteractiveRendererProps["status"] = "pending",
): InteractiveRendererProps {
  return {
    requestId: "r1",
    method: "bash-dispatch",
    params: {
      _promptBusComponent: { props: componentProps },
      title: componentProps.llmCommand ?? "cmd",
    },
    status,
    onRespond: () => {},
    onCancel: () => {},
  };
}

describe("BashDispatchRenderer", () => {
  it("container routing → container chip shown, no host chip", () => {
    const { getByText, queryByText } = render(
      <BashDispatchRenderer
        {...makeProps({ llmCommand: "ls", routing: "container", hasDevcontainer: true })}
      />,
    );
    expect(getByText("container")).toBeTruthy();
    expect(queryByText("host")).toBeNull();
  });

  it("host routing + hasDevcontainer=true → host chip shown", () => {
    const { getByText } = render(
      <BashDispatchRenderer
        {...makeProps({ llmCommand: "ls", routing: "host", hasDevcontainer: true })}
      />,
    );
    expect(getByText("host")).toBeTruthy();
  });

  it("host routing + hasDevcontainer=false → no host chip", () => {
    const { queryByText } = render(
      <BashDispatchRenderer
        {...makeProps({ llmCommand: "ls", routing: "host", hasDevcontainer: false })}
      />,
    );
    expect(queryByText("host")).toBeNull();
  });

  it("rtkRewritten=true + rtkCommand → RTK chip shown with title", () => {
    const { getByText } = render(
      <BashDispatchRenderer
        {...makeProps({ llmCommand: "ls", routing: "host", rtkRewritten: true, rtkCommand: "rtk grep" })}
      />,
    );
    const chip = getByText("RTK");
    expect(chip).toBeTruthy();
    expect(chip.getAttribute("title")).toBe("rtk grep");
  });

  it("routing=error + errorMessage → error chip with title", () => {
    const { getByText } = render(
      <BashDispatchRenderer
        {...makeProps({ llmCommand: "cmd", routing: "error", errorMessage: "routing failed" })}
      />,
    );
    const chip = getByText("error");
    expect(chip).toBeTruthy();
    expect(chip.getAttribute("title")).toBe("routing failed");
  });

  it("status=resolved → renders null", () => {
    const { container } = render(
      <BashDispatchRenderer
        {...makeProps({ llmCommand: "ls", routing: "container" }, "resolved")}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("status=cancelled → renders null", () => {
    const { container } = render(
      <BashDispatchRenderer
        {...makeProps({ llmCommand: "ls", routing: "container" }, "cancelled")}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("missing llmCommand and routing → renders null", () => {
    const { container } = render(
      <BashDispatchRenderer
        {...makeProps({})}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("empty params → renders null, no throw", () => {
    const props: InteractiveRendererProps = {
      requestId: "r2",
      method: "bash-dispatch",
      params: {},
      status: "pending",
      onRespond: () => {},
      onCancel: () => {},
    };
    const { container } = render(<BashDispatchRenderer {...props} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the command text", () => {
    const { getByText } = render(
      <BashDispatchRenderer
        {...makeProps({ llmCommand: "npm run build", routing: "host", hasDevcontainer: false })}
      />,
    );
    expect(getByText("npm run build")).toBeTruthy();
  });
});
