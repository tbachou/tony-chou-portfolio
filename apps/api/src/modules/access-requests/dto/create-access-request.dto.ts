import { IsEmail, IsIn } from 'class-validator';
import { APP_SLUGS } from '../app-slug';
import type { AppSlug } from '../app-slug';

export class CreateAccessRequestDto {
  @IsEmail()
  email: string;

  @IsIn(APP_SLUGS)
  appSlug: AppSlug;
}
