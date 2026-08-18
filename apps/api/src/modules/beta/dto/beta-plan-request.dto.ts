import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DISCIPLINES,
  EQUIPMENT_ACCESS,
  INJURY_AREAS,
  PAIN_BEHAVIORS,
  SYMPTOMS,
  type Discipline,
  type EquipmentAccess,
  type InjuryArea,
  type PainBehavior,
  type Symptom,
} from '../beta.constants';

// Free text is length-capped here, at the boundary, before any agent sees it
// (spec 0004 key invariant; AC-7).
export class BetaPlanRequestDto {
  @IsIn(INJURY_AREAS)
  injuryArea: InjuryArea;

  @IsInt()
  @Min(0)
  @Max(520)
  onsetWeeksAgo: number;

  @IsArray()
  @ArrayMaxSize(SYMPTOMS.length)
  @IsIn(SYMPTOMS, { each: true })
  symptoms: Symptom[];

  @IsIn(PAIN_BEHAVIORS)
  painBehavior: PainBehavior;

  // Constrained, not an enum: grades come in many systems (V5, 5.11a, 6b+).
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  @Matches(/^[A-Za-z0-9 .+/-]+$/, {
    message:
      'preInjuryGrade must be a plain climbing grade like V5, 5.11a, or 6b+',
  })
  preInjuryGrade: string;

  @IsIn(DISCIPLINES)
  discipline: Discipline;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  goals?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(14)
  sessionsPerWeek?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EQUIPMENT_ACCESS.length)
  @IsIn(EQUIPMENT_ACCESS, { each: true })
  equipmentAccess?: EquipmentAccess[];
}
