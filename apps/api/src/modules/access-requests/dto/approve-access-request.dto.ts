import { IsUrl } from 'class-validator';

export class ApproveAccessRequestDto {
  @IsUrl()
  downloadUrl: string;
}
