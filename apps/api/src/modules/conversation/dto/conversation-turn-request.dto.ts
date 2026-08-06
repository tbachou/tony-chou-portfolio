import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { HistoryTurnDto } from './history-turn.dto';

export class ConversationTurnRequestDto {
  @IsString()
  @IsNotEmpty()
  topicId: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => HistoryTurnDto)
  history: HistoryTurnDto[] = [];
}
