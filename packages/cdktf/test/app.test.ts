import {
  CONTEXT_ENV,
  App,
  TerraformStack,
  TerraformResource,
  Testing,
  DataTerraformRemoteStateLocal,
  LocalBackend,
  HttpBackend,
  RemoteBackend,
  DataTerraformRemoteState,
} from "../lib";

import { version } from "../package.json";
import fs = require("fs");
import path = require("path");
import os = require("os");
import { Aspects } from "../lib/aspect";
import { IConstruct } from "constructs";
import { setupJest } from "../lib/testing/adapters/jest";
import { TestProvider, TestResource } from "./helper";
setupJest();

test("context can be passed through CDKTF_CONTEXT", () => {
  process.env[CONTEXT_ENV] = JSON.stringify({
    key1: "val1",
    key2: "val2",
  });
  const prog = new App();
  const node = prog.node;
  expect(node.tryGetContext("key1")).toEqual("val1");
  expect(node.tryGetContext("key2")).toEqual("val2");
});

test("context can be passed through CDKTF_CONTEXT", () => {
  process.env[CONTEXT_ENV] = JSON.stringify({
    key1: "val1",
    key2: "val2",
  });
  const prog = new App({
    context: {
      key1: "val3",
      key2: "val4",
    },
  });
  const node = prog.node;
  expect(node.tryGetContext("key1")).toEqual("val1");
  expect(node.tryGetContext("key2")).toEqual("val2");
});

test("cdktfVersion is accessible in context", () => {
  const prog = new App();
  const node = prog.node;
  expect(node.tryGetContext("cdktfVersion")).toEqual(version);
});

test("app synth does not throw error when validatons are disabled", () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "cdktf.outdir."));
  const app = Testing.stubVersion(
    new App({ stackTraces: false, outdir, skipValidation: true })
  );
  const stack = new TerraformStack(app, "MyStack");

  new MyResource(stack, "Resource1", {
    terraformResourceType: "aws_bucket",
    terraformGeneratorMetadata: {
      providerName: "test-provider",
    },
  });

  expect(() => app.synth()).not.toThrow();
});

test("app synth throws error when provider is missing", () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "cdktf.outdir."));
  const app = Testing.stubVersion(new App({ stackTraces: false, outdir }));
  const stack = new TerraformStack(app, "MyStack");

  new MyResource(stack, "Resource1", {
    terraformResourceType: "aws_bucket",
    terraformGeneratorMetadata: {
      providerName: "test-provider",
    },
  });

  expect(() => app.synth()).toThrowErrorMatchingInlineSnapshot(`
    "Validation failed with the following errors:
      [MyStack] Found resources without a matching provider. Please make sure to add the following providers to your stack: test-provider"
  `);
});

test("app synth executes Aspects", () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "cdktf.outdir."));
  const app = Testing.stubVersion(
    new App({ stackTraces: false, outdir, skipValidation: true })
  );
  const stack = new TerraformStack(app, "MyStack");

  const StackAspect = { visit: jest.fn() };
  const ResourceAspect = {
    visit: jest.fn().mockImplementation((resource: IConstruct) => {
      const inferredStack = TerraformStack.of(resource);
      new MyResource(inferredStack, "Resource2", {
        terraformResourceType: "aws_bucket",
        terraformGeneratorMetadata: {
          providerName: "test-provider",
        },
      });
    }),
  };

  const resource = new MyResource(stack, "Resource1", {
    terraformResourceType: "aws_bucket",
    terraformGeneratorMetadata: {
      providerName: "test-provider",
    },
  });

  Aspects.of(stack).add(StackAspect);
  Aspects.of(resource).add(ResourceAspect);

  expect(() => app.synth()).not.toThrow();

  expect(StackAspect.visit).toHaveBeenNthCalledWith(1, stack);
  expect(StackAspect.visit).toHaveBeenNthCalledWith(2, resource);
  expect(ResourceAspect.visit).toHaveBeenCalledWith(resource);

  expect(Testing.renderConstructTree(app)).toMatchInlineSnapshot(`
    "App
    └── MyStack (TerraformStack)
        ├── Resource1 (MyResource)
        └── Resource2 (MyResource)
    "
  `);
});

class MyResource extends TerraformResource {}

describe("Cross Stack references", () => {
  class OriginStack extends TerraformStack {
    public resource: TestResource;
    constructor(scope: App, id: string) {
      super(scope, id);

      new TestProvider(this, "TestProvider", {});

      this.resource = new TestResource(this, "resource", {
        name: "resource",
      });
    }
  }
  let app: App;
  let originStack: OriginStack;
  let testStack: TerraformStack;

  beforeEach(() => {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "cdktf.outdir."));
    app = Testing.stubVersion(new App({ stackTraces: false, outdir }));
    originStack = new OriginStack(app, "OriginStack");
    testStack = new TerraformStack(app, "TestStack");
    new TestProvider(testStack, "TestProvider", {});
  });

  function getStackSynths(app: App): {
    originStackSynth: string;
    targetStackSynth: string;
  } {
    const originStackSynth = fs.readFileSync(
      path.resolve(app.outdir, "stacks", "OriginStack", "cdk.tf.json"),
      "utf8"
    );
    const targetStackSynth = fs.readFileSync(
      path.resolve(app.outdir, "stacks", "TestStack", "cdk.tf.json"),
      "utf8"
    );
    return { originStackSynth, targetStackSynth };
  }

  it("without cross stack references no extra resources are created", () => {
    app.synth();
    const { originStackSynth, targetStackSynth } = getStackSynths(app);

    expect(JSON.parse(originStackSynth).output).toBe(undefined);
    expect(targetStackSynth).not.toHaveDataSource(
      DataTerraformRemoteStateLocal
    );
  });

  it("creates remote state and output", () => {
    new TestResource(testStack, "Resource", {
      name: originStack.resource.stringValue,
    });
    new RemoteBackend(originStack, {
      organization: "testorg",
      workspaces: {
        name: "testworkspace",
      },
    });

    app.synth();
    const { originStackSynth, targetStackSynth } = getStackSynths(app);

    expect(Object.keys(JSON.parse(originStackSynth).output).length).toBe(1);
    expect(targetStackSynth).toHaveDataSource(DataTerraformRemoteStateLocal);
  });

  it("infers the correct path for local state", () => {
    const tfStatePath = path.resolve(
      process.cwd(),
      `terraform.OriginStack.tfstate`
    );
    new TestResource(testStack, "Resource", {
      name: originStack.resource.stringValue,
    });

    // Would error if the path was not correct
    fs.writeFileSync(tfStatePath, "foo", "utf8");

    try {
      app.synth();
    } finally {
      fs.rmSync(tfStatePath);
    }

    const { originStackSynth, targetStackSynth } = getStackSynths(app);

    expect(Object.keys(JSON.parse(originStackSynth).output).length).toBe(1);
    expect(targetStackSynth).toHaveDataSourceWithProperties(
      DataTerraformRemoteStateLocal,
      {
        backend: "local",
        config: {
          path: expect.stringContaining("assets"),
        },
      }
    );
  });

  it("passes backend configuration to remote state definition", () => {
    new TestResource(testStack, "Resource", {
      name: originStack.resource.stringValue,
    });

    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "cdktf.outdir."));
    const targetPath = path.join(outdir, "terraform.tfstate");
    fs.writeFileSync(targetPath, "myState", "utf8");
    new LocalBackend(originStack, {
      path: targetPath,
    });

    app.synth();
    const { originStackSynth, targetStackSynth } = getStackSynths(app);

    expect(Object.keys(JSON.parse(originStackSynth).output).length).toBe(1);
    expect(targetStackSynth).toHaveDataSourceWithProperties(
      DataTerraformRemoteStateLocal,
      {
        backend: "local",
        config: {
          // TODO:
          path: expect.stringContaining("assets"),
        },
      }
    );
  });
  it("errors if cross stack references are used with unsupported backends", () => {
    new TestResource(testStack, "Resource", {
      name: originStack.resource.stringValue,
    });

    new HttpBackend(originStack, { address: "http://example.com" });

    expect(() => app.synth()).toThrowError(
      /This Backend is not implemented yet/
    );
  });

  it("uses the same remote state type as the origin stacks backend", () => {
    new TestResource(testStack, "Resource", {
      name: originStack.resource.stringValue,
    });

    new RemoteBackend(originStack, {
      organization: "testorg",
      workspaces: {
        name: "testworkspace",
      },
    });

    app.synth();
    const { originStackSynth, targetStackSynth } = getStackSynths(app);

    expect(Object.keys(JSON.parse(originStackSynth).output).length).toBe(1);
    expect(targetStackSynth).toHaveDataSourceWithProperties(
      DataTerraformRemoteState,
      {
        backend: "remote",
        config: {
          organization: "testorg",
          workspaces: {
            name: "testworkspace",
          },
        },
      }
    );
  });
  it.todo("uses assets for local state");

  it.todo("creates a dependency graph between stacks in manifest");
  it.todo("throws an error when a stack is referenced from a different app");
  it.todo("throws an error when there is a circular stack dependency");

  it.todo("references primitive values");
  it.todo("references complex values");
  it.todo("references nested values");

  it.todo("references terraform function output");
  it.todo("can use reference in terraform function");

  it.todo("references can be passed through stacks");

  it.todo("one reference can be used in multiple stacks");
});
