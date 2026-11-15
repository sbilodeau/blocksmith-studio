import { z } from 'zod'
import type { EntityBox, EntityDefinition, EntityPart } from '../model/preview'

/**
 * zod schema of the built-in entity geometry files (resources/data/entity-models/*.json). It mirrors the
 * EntityDefinition contract in src/shared/model/preview.ts; see docs/entity-models.md for the authoring guide.
 */

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const ENTITY_PART_ROLES = [
  'head',
  'body',
  'rightArm',
  'leftArm',
  'rightLeg',
  'leftLeg',
  'frontRightLeg',
  'frontLeftLeg',
  'backRightLeg',
  'backLeftLeg',
  'tail',
  'wing'
] as const

export const EntityBoxSchema = z.strictObject({
  origin: Vec3Schema,
  /** Sizes may be 0 for flat planes (ears, fins), never negative. */
  size: z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]),
  uv: z.tuple([z.number().min(0), z.number().min(0)]),
  mirror: z.boolean().optional(),
  /** Negative values shrink the box (e.g. the enderman's inner jaw). Per axis for jar models. */
  inflate: z.union([z.number(), Vec3Schema]).optional(),
  uvScale: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  faces: z.array(z.enum(['top', 'bottom', 'right', 'front', 'left', 'back'])).optional()
}) satisfies z.ZodType<EntityBox>

export const EntityPartSchema: z.ZodType<EntityPart> = z.lazy(() =>
  z.strictObject({
    name: z.string().regex(/^[a-z0-9_]+$/),
    pivot: Vec3Schema,
    rotation: Vec3Schema.optional(),
    role: z.enum(ENTITY_PART_ROLES).optional(),
    scale: Vec3Schema.optional(),
    boxes: z.array(EntityBoxSchema),
    children: z.array(EntityPartSchema).optional()
  })
)

export const EntityDefinitionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/),
  textureSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** Pack paths, globs allowed (see src/shared/categories/glob.ts). */
  textures: z.array(z.string().startsWith('assets/')).min(1),
  parts: z.array(EntityPartSchema).min(1),
  animation: z.enum(['biped', 'quadruped', 'none']).optional()
}) satisfies z.ZodType<EntityDefinition>
