#!/usr/bin/env bun

import { Skill } from "./packages/opencode/src/skill/skill"

async function main() {
  console.log("=== Testing Skill Loading ===\n")

  // Test 1: Check all skills
  console.log("1. All loaded skills:")
  const allSkills = await Skill.all()
  console.log(`   Total: ${allSkills.length}`)
  console.log(`   Names: ${allSkills.map((s) => s.name).sort().join(", ")}`)
  console.log()

  // Test 2: Check g6-parser specifically
  console.log("2. g6-parser skill:")
  const g6Parser = await Skill.get("g6-parser")
  if (g6Parser) {
    console.log(`   ✓ Found: ${g6Parser.name}`)
    console.log(`   Location: ${g6Parser.location}`)
    console.log(`   Description: ${g6Parser.description}`)
  } else {
    console.log("   ✗ Not found")
  }
  console.log()

  // Test 3: Run test function
  console.log("3. Test function results:")
  const testResult = await Skill.test()
  console.log(JSON.stringify(testResult, null, 2))
  console.log()

  // Test 4: Check file directly
  console.log("4. Direct file check:")
  const fs = await import("fs/promises")
  const path = await import("path")
  const os = await import("os")
  const globalSkillsDir = path.join(os.homedir(), ".opencode", "skills")
  const g6ParserPath = path.join(globalSkillsDir, "g6-parser", "SKILL.md")
  try {
    const stats = await fs.stat(g6ParserPath)
    console.log(`   ✓ File exists: ${g6ParserPath}`)
    console.log(`   Size: ${stats.size} bytes`)
    const content = await fs.readFile(g6ParserPath, "utf-8")
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1]
      const nameMatch = frontmatter.match(/name:\s*(.+)/)
      if (nameMatch) {
        console.log(`   Name in frontmatter: ${nameMatch[1].trim()}`)
      }
    }
  } catch (error) {
    console.log(`   ✗ File not found: ${error}`)
  }
}

main().catch(console.error)
