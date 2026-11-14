#!/usr/bin/env bun
// The GUI plugin SDK is learned from editor hovers, so its doc comments are checked. Fails, naming each file and
// line, when in `packages/plugin/src/gui`:
// - an exported declaration, an interface member, a field of an object type (an option, a result, a union member), or
//   a member of an exported object such as `Store.global` has no doc comment;
// - a documented function or method leaves a parameter without `@param`, or names one it does not have.
// Usage: bun script/sdk-docs.ts
import path from "node:path"
import { Glob } from "bun"
import ts from "typescript"

const root = path.resolve(import.meta.dir, "..")
const sdk = path.join(root, "packages/plugin/src/gui")

const problems: string[] = []
const counts = { declarations: 0, members: 0, parameters: 0 }

const files = [...new Glob("**/*.{ts,tsx}").scanSync(sdk)]
  .filter((file) => !/\.(test|typecheck)\.tsx?$/.test(file))
  .toSorted()
  .map((file) => path.join(sdk, file))

const sources = await Promise.all(files.map(async (file) => parse(file, await Bun.file(file).text())))

sources.forEach((source) => source.statements.forEach((statement) => checkStatement(source, statement)))

problems.forEach((problem) => console.log(problem))
console.log(
  `sdk-docs: ${counts.declarations} declarations, ${counts.members} members and ${counts.parameters} parameters ` +
    `documented in ${files.length} files; ${problems.length} problem(s)`,
)
process.exit(problems.length > 0 ? 1 : 0)

function checkStatement(source: ts.SourceFile, statement: ts.Statement) {
  if (!exported(statement)) return

  const name = describe(statement)

  if (ts.isVariableStatement(statement)) {
    documented(source, statement, name, "declarations")
    statement.declarationList.declarations.forEach((declaration) => {
      if (declaration.type) checkTypes(source, declaration.type, name)

      if (declaration.initializer) checkInitializer(source, declaration.initializer, name)
    })

    return
  }

  if (name === undefined) return

  documented(source, statement, name, "declarations")

  if (ts.isFunctionDeclaration(statement)) return checkSignature(source, statement, name)

  if (ts.isInterfaceDeclaration(statement)) return checkMembers(source, statement.members, name)

  if (ts.isTypeAliasDeclaration(statement)) return checkTypes(source, statement.type, name)

  if (ts.isEnumDeclaration(statement))
    statement.members.forEach((member) =>
      documented(source, member, `${name}.${member.name.getText(source)}`, "members"),
    )
}

/** An exported const: the type arguments of its initializer, or each member of an object literal such as `Store`. */
function checkInitializer(source: ts.SourceFile, initializer: ts.Expression, owner: string) {
  if (!ts.isObjectLiteralExpression(initializer)) return checkTypes(source, initializer, owner)

  initializer.properties.forEach((property) => {
    const name = `${owner}.${property.name?.getText(source) ?? "…"}`

    documented(source, property, name, "members")

    const value = ts.isPropertyAssignment(property) ? property.initializer : property

    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isMethodDeclaration(value))
      checkSignature(source, value, name, property)
  })
}

function checkMembers(source: ts.SourceFile, members: ts.NodeArray<ts.TypeElement>, owner: string) {
  members.forEach((member) => {
    if (ts.isIndexSignatureDeclaration(member)) return checkTypes(source, member.type, owner)

    const name = `${owner}.${member.name?.getText(source) ?? "(call)"}`

    documented(source, member, name, "members")

    if (ts.isMethodSignature(member) || ts.isCallSignatureDeclaration(member))
      return checkSignature(source, member, name)

    if (ts.isPropertySignature(member) && member.type) checkTypes(source, member.type, name)
  })
}

/** A function or method: a `@param` per parameter, and the object types of its parameters and result. */
function checkSignature(source: ts.SourceFile, signature: ts.SignatureDeclaration, name: string, host?: ts.Node) {
  checkParameters(source, signature, name, host)
  signature.parameters.forEach((parameter) => parameter.type && checkTypes(source, parameter.type, name))

  if (signature.type) checkTypes(source, signature.type, name)
}

/**
 * Every object type within a type: option objects, results and union members. A conditional type's `extends` clause is
 * a pattern, not a shape anyone writes, and a function's body is implementation.
 */
function checkTypes(source: ts.SourceFile, node: ts.Node, owner: string) {
  if (ts.isTypeLiteralNode(node)) return checkMembers(source, node.members, owner)

  if (ts.isConditionalTypeNode(node))
    return [node.checkType, node.trueType, node.falseType].forEach((type) => checkTypes(source, type, owner))

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    node.parameters.forEach((parameter) => parameter.type && checkTypes(source, parameter.type, owner))

    if (node.type) checkTypes(source, node.type, owner)

    return
  }

  ts.forEachChild(node, (child) => checkTypes(source, child, owner))
}

/** Each parameter has a `@param`, and no `@param` names a parameter the signature lacks. */
function checkParameters(source: ts.SourceFile, signature: ts.SignatureDeclaration, name: string, host?: ts.Node) {
  const names = signature.parameters.map((parameter) => parameter.name.getText(source))
  const tags = docs(host ?? signature).flatMap((doc) => (doc.tags ?? []).filter(ts.isJSDocParameterTag))

  signature.parameters.forEach((parameter, index) => {
    if (tags.some((tag) => tag.name.getText(source) === names[index])) return void counts.parameters++

    report(source, parameter, `${name}: parameter \`${names[index]}\` has no @param`)
  })
  tags.forEach((tag) => {
    if (!names.includes(tag.name.getText(source)))
      report(source, tag, `${name}: @param \`${tag.name.getText(source)}\` names no parameter`)
  })
}

function documented(source: ts.SourceFile, node: ts.Node, name: string, kind: "declarations" | "members") {
  const described = docs(node).some((doc) => !!ts.getTextOfJSDocComment(doc.comment)?.trim())

  if (described) return void counts[kind]++

  report(source, node, `${name} has no doc comment`)
}

function docs(node: ts.Node) {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
}

function exported(statement: ts.Statement) {
  return (
    ts.canHaveModifiers(statement) &&
    !!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  )
}

/** The declared name, or undefined for a statement that declares nothing, such as `export * from`. */
function describe(statement: ts.Statement) {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.map((declaration) => declaration.name.getText()).join(", ")

  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  )
    return statement.name?.getText() ?? "default"

  return undefined
}

function report(source: ts.SourceFile, node: ts.Node, message: string) {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))

  problems.push(`${relative(source.fileName)}:${position.line + 1}:${position.character + 1}  ${message}`)
}

function relative(file: string) {
  return path.relative(root, file).replaceAll(path.sep, "/")
}

function parse(file: string, text: string) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}
