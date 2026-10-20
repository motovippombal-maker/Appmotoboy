import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode(predicate: (node: ts.Node) => boolean, parent: ts.Node = parsed): ts.Node | undefined {
  if (predicate(parent)) return parent;
  return ts.forEachChild(parent, (node) => findNode(predicate, node));
}

// Exercise the actual nested React actions without replacing them with a test copy.
export function bookingActionContext(values: Record<string, unknown>) {
  const panel = findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === "PassengerPanel");
  assert.ok(panel);
  const calculate = findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === "calculate", panel);
  const picker = findNode((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "MapAddressPicker", panel);
  const pickup = findNode((node) => ts.isJsxOpeningElement(node) && node.attributes.properties.some((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === "className" &&
    attribute.initializer?.getText(parsed) === '"motovip-address-pickup"'), panel);
  assert.ok(calculate && picker && pickup);
  const attribute = (parent: ts.Node, name: string) => {
    const match = findNode((node) => ts.isJsxAttribute(node) && node.name.getText(parsed) === name, parent);
    assert.ok(match && ts.isJsxAttribute(match) && match.initializer && ts.isJsxExpression(match.initializer) && match.initializer.expression);
    return match.initializer.expression.getText(parsed);
  };
  const code = `${calculate.getText(parsed)}\nconst confirmMapAddress = ${attribute(picker, "onConfirm")};\nconst clickPickup = ${attribute(pickup, "onClick")};`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const context = createContext(values);
  runInContext(compiled, context);
  return {
    calculate: () => runInContext("calculate()", context) as Promise<void>,
    confirmMapAddress: (point: unknown) => {
      context.confirmedPoint = point;
      runInContext("confirmMapAddress(confirmedPoint)", context);
    },
    clickPickup: () => runInContext("clickPickup()", context),
    values: context,
  };
}
