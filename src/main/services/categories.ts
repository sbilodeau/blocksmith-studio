import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  CategoryMappingSchema,
  userCategoryRules,
  validateCategoryRules,
  type CategoryRule
} from '@shared/categories'
import type { CategoryMappingState } from '@shared/model/pack'
import { AppErrorException } from '../ipc/registry'
import { writeFileAtomic } from './packs/files'

/** Error codes of the category editor (i18n: `errors.<code>`). */
export const CategoryErrorCode = {
  /** A glob that cannot match anything (unbalanced braces, backslash, empty...). Params: category, glob. */
  invalidGlob: 'categories.invalidGlob',
  /** Two categories with the same id. Params: id. */
  duplicateId: 'categories.duplicateId',
  /** Any other problem in a category (id, label, icon, hidden fallback, too many globs). Params: category. */
  invalidRule: 'categories.invalidRule'
} as const

/** Refuses a rule list with any issue (validateCategoryRules), as a typed AppError. */
export function assertValidCategoryRules(rules: readonly CategoryRule[]): void {
  const issue = validateCategoryRules(rules)[0]
  if (!issue) return
  if (issue.code === 'glob') {
    throw new AppErrorException(CategoryErrorCode.invalidGlob, {
      category: issue.id,
      glob: issue.glob ?? ''
    })
  }
  if (issue.code === 'duplicateId') {
    throw new AppErrorException(CategoryErrorCode.duplicateId, { id: issue.id })
  }
  throw new AppErrorException(CategoryErrorCode.invalidRule, { category: issue.id })
}

/**
 * The "All packs" category mapping: the user's copy of the whole mapping in `userData/categories.json` (same schema
 * as resources/data/categories.json). A missing or invalid file means the defaults (an invalid file is kept as
 * categories.json.bak). Reset removes the file.
 */
export class CategoryMappingStore {
  private saved: CategoryRule[] | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  static forUserData(userDataDir: string): CategoryMappingStore {
    return new CategoryMappingStore(join(userDataDir, 'categories.json'))
  }

  async load(): Promise<CategoryMappingState> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch {
      this.saved = null
      return this.state()
    }
    let parsed: ReturnType<typeof CategoryMappingSchema.safeParse> | null
    try {
      parsed = CategoryMappingSchema.safeParse(JSON.parse(raw))
    } catch {
      parsed = null
    }
    if (parsed?.success && validateCategoryRules(parsed.data.categories).length === 0) {
      this.saved = parsed.data.categories
    } else {
      this.saved = null
      await fs.copyFile(this.filePath, `${this.filePath}.bak`).catch(() => undefined)
    }
    return this.state()
  }

  /** The saved user mapping, or null when the defaults apply. */
  savedRules(): CategoryRule[] | null {
    return this.saved
  }

  /** The "All packs" rules (saved mapping or defaults, plus built-ins added since it was saved). */
  rules(): CategoryRule[] {
    return userCategoryRules(this.saved)
  }

  state(): CategoryMappingState {
    return { rules: this.rules(), customized: this.saved !== null }
  }

  /** Validates and saves the whole mapping. */
  async save(rules: readonly CategoryRule[]): Promise<CategoryMappingState> {
    assertValidCategoryRules(rules)
    const mapping = CategoryMappingSchema.parse({ schemaVersion: 1, categories: rules })
    this.saved = mapping.categories
    await this.enqueue(() =>
      writeFileAtomic(this.filePath, `${JSON.stringify(mapping, null, 2)}\n`)
    )
    return this.state()
  }

  /** Back to the default mapping (removes the user file). */
  async reset(): Promise<CategoryMappingState> {
    this.saved = null
    await this.enqueue(() => fs.rm(this.filePath, { force: true }))
    return this.state()
  }

  private async enqueue(write: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(write, write)
    await this.writeQueue
  }
}
