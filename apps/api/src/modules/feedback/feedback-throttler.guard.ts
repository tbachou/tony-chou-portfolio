import { Injectable } from '@nestjs/common';
import { CollapsedIpThrottlerGuard } from '../../common/guards/collapsed-ip-throttler.guard';

/**
 * In-memory throttle for POST /feedback: 5 per hour per collapsed IP
 * identity (AC-I3), set via @Throttle on the controller route. No extra
 * behavior beyond the shared IPv6-collapsing tracker — feedback has no
 * usage-tally service to bump on rejection, unlike BetaThrottlerGuard.
 */
@Injectable()
export class FeedbackThrottlerGuard extends CollapsedIpThrottlerGuard {}
