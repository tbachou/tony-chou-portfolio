import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_SOURCES,
  type FeedbackCategoryValue,
  type FeedbackSourceValue,
} from '../feedback.constants';

// AC-I1 / AC-I4: message is required, 1..2000 chars; category is optional;
// source is required. AC-I2: no email, name, or account field exists here —
// do not add one without a new spec.
export class CreateFeedbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(FEEDBACK_MESSAGE_MAX_LENGTH)
  message: string;

  @IsOptional()
  @IsIn(FEEDBACK_CATEGORIES)
  category?: FeedbackCategoryValue;

  @IsIn(FEEDBACK_SOURCES)
  source: FeedbackSourceValue;
}
