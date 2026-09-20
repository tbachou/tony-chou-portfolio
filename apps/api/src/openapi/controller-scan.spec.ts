import {
  joinRoutePath,
  routeKey,
  scanControllerSource,
  type ScanResult,
  type ScannedRoute,
} from './controller-scan';

const NEST = `import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UsePipes } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
`;

function scan(body: string, prelude = NEST): ScanResult {
  return scanControllerSource(prelude + body, 'test.controller.ts');
}

function only(body: string, prelude = NEST): ScannedRoute {
  const result = scan(body, prelude);
  expect(result.problems).toEqual([]);
  expect(result.routes).toHaveLength(1);
  return result.routes[0];
}

describe('joinRoutePath', () => {
  it('joins a controller prefix to a handler path', () => {
    expect(joinRoutePath('grade', 'guess')).toBe('/grade/guess');
  });

  it('rewrites express parameters into OpenAPI braces', () => {
    expect(joinRoutePath('grade', 'problems/:publicId/image')).toBe(
      '/grade/problems/{publicId}/image',
    );
  });

  it('gives the root path when both parts are empty', () => {
    expect(joinRoutePath('', '')).toBe('/');
  });

  it('ignores stray slashes rather than producing an empty segment', () => {
    expect(joinRoutePath('/internal/grade-photos/', '/:id/active')).toBe(
      '/internal/grade-photos/{id}/active',
    );
  });
});

describe('the ordinary shapes this repo uses', () => {
  it('reads the method, path and handler name', () => {
    const route = only(`
      @Controller('grade')
      export class GradeController {
        @Get('problems')
        problems() {}
      }
    `);
    expect(routeKey(route)).toBe('GET /grade/problems');
    expect(route.handler).toBe('GradeController.problems');
    expect(route.className).toBe('GradeController');
  });

  it('treats a class level @AllowAnonymous as covering every handler', () => {
    expect(
      only(`
      @Controller('health')
      @AllowAnonymous()
      export class HealthController {
        @Get()
        check() {}
      }
    `).anonymous,
    ).toBe(true);
  });

  it('reports a route with no exemption decorator as protected', () => {
    expect(
      only(`
      @Controller('internal/usage')
      export class UsageController {
        @Get('summary')
        getSummary() {}
      }
    `).anonymous,
    ).toBe(false);
  });

  it('records the schema a validation pipe was constructed with', () => {
    expect(
      only(`
      @Controller('feedback')
      export class FeedbackController {
        @Post()
        create(@Body(new ZodValidationPipe(createFeedbackSchema)) dto: unknown) {}
      }
    `).bindings,
    ).toEqual([{ kind: 'Body', validated: true, schemaName: 'createFeedbackSchema' }]);
  });

  it('records a binding with no pipe as unvalidated', () => {
    expect(
      only(`
      @Controller('feedback')
      export class FeedbackController {
        @Post()
        create(@Body() dto: unknown) {}
      }
    `).bindings,
    ).toEqual([{ kind: 'Body', validated: false }]);
  });

  it('ignores @Req, @Res and @UploadedFile, which carry no schema', () => {
    expect(
      only(`
      @Controller('beta')
      export class BetaController {
        @Post('plan')
        plan(@Req() req: unknown, @Res() res: unknown, @UploadedFile() f?: unknown) {}
      }
    `).bindings,
    ).toEqual([]);
  });

  it('does not read decorators written inside comments', () => {
    const route = only(`
      @Controller('grade')
      @AllowAnonymous()
      export class GradeController {
        // Every handler below used to take @Body() with no pipe, and
        // @AllowAnonymous() was once applied per handler instead.
        /* @Post('guess') guess(@Body() body: unknown) {} */
        @Get('problems')
        problems() {}
      }
    `);
    expect(routeKey(route)).toBe('GET /grade/problems');
    expect(route.bindings).toEqual([]);
  });
});

// Every case below is an attack the adversarial pass confirmed against the
// first version of this scan. Each one shipped a live route that the check
// reported as clean. They are the specification now.

describe('better-auth exemptions beyond @AllowAnonymous (adversarial HIGH 4)', () => {
  // `Public` is a direct alias of `AllowAnonymous`, and `OptionalAuth` lets a
  // request with no session through. The guard honours PUBLIC and OPTIONAL
  // metadata; matching only one name published a false "session required".
  it.each(['Public', 'AllowAnonymous', 'OptionalAuth', 'Optional'])(
    'treats @%s() as reachable without a session',
    (decorator) => {
      const route = only(
        `
        @Controller('internal/usage')
        @${decorator}()
        export class UsageController {
          @Get('summary')
          getSummary() {}
        }
      `,
        `import { Controller, Get } from '@nestjs/common';
import { ${decorator} } from '@thallesp/nestjs-better-auth';
`,
      );
      expect(route.anonymous).toBe(true);
    },
  );

  it('sees through an aliased exemption import', () => {
    const route = only(
      `
      @Controller('internal/usage')
      @Open()
      export class UsageController {
        @Get('summary')
        getSummary() {}
      }
    `,
      `import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous as Open } from '@thallesp/nestjs-better-auth';
`,
    );
    expect(route.anonymous).toBe(true);
  });

  it('refuses to guess at an unrecognised better-auth decorator', () => {
    // So the next decorator the library adds cannot silently reopen this hole.
    const result = scan(
      `
      @Controller('internal/usage')
      @SomeNewEscapeHatch()
      export class UsageController {
        @Get('summary')
        getSummary() {}
      }
    `,
      `import { Controller, Get } from '@nestjs/common';
import { SomeNewEscapeHatch } from '@thallesp/nestjs-better-auth';
`,
    );
    expect(result.problems.map((p) => p.message).join(' ')).toMatch(/SomeNewEscapeHatch/);
  });
});

describe('aliased Nest imports (adversarial HIGH 3)', () => {
  it('sees a @Body bound under an alias', () => {
    // `import { Body as ReqBody }` made the binding vanish entirely, so the
    // pipe check had nothing to report and POST /feedback shipped unvalidated.
    expect(
      only(
        `
        @Controller('feedback')
        export class FeedbackController {
          @Post()
          create(@ReqBody() dto: unknown) {}
        }
      `,
        `import { Body as ReqBody, Controller, Post } from '@nestjs/common';
`,
      ).bindings,
    ).toEqual([{ kind: 'Body', validated: false }]);
  });

  it('sees a controller declared with an aliased @Controller', () => {
    expect(
      only(
        `
        @RestController('grade')
        export class GradeController {
          @Fetch('problems')
          problems() {}
        }
      `,
        `import { Controller as RestController, Get as Fetch } from '@nestjs/common';
`,
      ).path,
    ).toBe('/grade/problems');
  });

  it('rejects a pipe that is merely named ZodValidationPipe', () => {
    // The mirror of the attack: aliasing some other pipe to the expected name
    // reported `validated: true` for a pipe that validates nothing of ours.
    expect(
      only(
        `
        @Controller('feedback')
        export class FeedbackController {
          @Post()
          create(@Body(new ZodValidationPipe(schema)) dto: unknown) {}
        }
      `,
        `import { Body, Controller, Post } from '@nestjs/common';
import { SomeOtherPipe as ZodValidationPipe } from './not-the-real-pipe';
`,
      ).bindings,
    ).toEqual([{ kind: 'Body', validated: false }]);
  });
});

describe('classes the scan used to be blind to (adversarial HIGH 2)', () => {
  it('finds a controller nested in a block', () => {
    const result = scan(`
      {
        @Controller('hidden')
        export class HiddenController {
          @Post('x')
          x(@Body() b: unknown) {}
        }
      }
    `);
    expect(result.routes.map(routeKey)).toEqual(['POST /hidden/x']);
  });

  it('finds a controller nested in a namespace', () => {
    const result = scan(`
      namespace N {
        @Controller('ns')
        export class NsController {
          @Post('hidden')
          hidden(@Body() b: unknown) {}
        }
      }
    `);
    expect(result.routes.map(routeKey)).toEqual(['POST /ns/hidden']);
  });

  it('finds handlers inherited from a base class in the same file', () => {
    // NestJS walks the prototype chain, so these routes are really served.
    const result = scan(`
      class BaseController {
        @Post('a')
        a(@Body() body: unknown) {}
      }
      @Controller('x')
      export class XController extends BaseController {}
    `);
    expect(result.problems).toEqual([]);
    expect(result.routes.map(routeKey)).toEqual(['POST /x/a']);
    expect(result.routes[0].bindings).toEqual([{ kind: 'Body', validated: false }]);
  });

  it('refuses to pass a controller whose base class it cannot resolve', () => {
    const result = scan(
      `
      @Controller('x')
      export class XController extends BaseController {}
    `,
      `import { Controller } from '@nestjs/common';
import { BaseController } from './base';
`,
    );
    expect(result.problems.map((p) => p.message).join(' ')).toMatch(/BaseController/);
  });

  it('flags a file that imports @Controller but yields no controller', () => {
    const result = scan(
      `
      export const notAController = 1;
    `,
      `import { Controller } from '@nestjs/common';
`,
    );
    expect(result.problems).not.toEqual([]);
  });
});

describe('arguments the scan cannot safely read (adversarial MEDIUM 7)', () => {
  // These used to default to '' and produce a misdiagnosing failure that sent
  // the reader off to "fix the registry", which would publish a wrong path.
  it('refuses the @Controller object form rather than dropping the prefix', () => {
    const result = scan(`
      @Controller({ path: 'health' })
      export class HealthController {
        @Get()
        check() {}
      }
    `);
    expect(result.problems.map((p) => p.message).join(' ')).toMatch(/Controller/);
  });

  it('refuses an array of paths rather than documenting neither', () => {
    const result = scan(`
      @Controller('grade')
      export class GradeController {
        @Get(['problems', 'legacy-problems'])
        problems() {}
      }
    `);
    expect(result.problems).not.toEqual([]);
  });

  it('refuses a template literal path', () => {
    const result = scan(`
      @Controller(\`\${BASE}\`)
      export class GradeController {
        @Get('problems')
        problems() {}
      }
    `);
    expect(result.problems).not.toEqual([]);
  });
});

describe('rate limiting, so the published prose can be checked', () => {
  it('records a handler level @Throttle', () => {
    expect(
      only(`
      @Controller('feedback')
      export class FeedbackController {
        @Throttle({ long: { limit: 5, ttl: 1000 } })
        @Post()
        create() {}
      }
    `).throttled,
    ).toBe(true);
  });

  it('records a class level throttler guard', () => {
    expect(
      only(`
      @Controller('grade')
      @UseGuards(CollapsedIpThrottlerGuard)
      export class GradeController {
        @Get('problems')
        problems() {}
      }
    `).throttled,
    ).toBe(true);
  });

  it('records an unthrottled route as unthrottled', () => {
    expect(
      only(`
      @Controller('stories')
      export class StoriesController {
        @Get()
        findAll() {}
      }
    `).throttled,
    ).toBe(false);
  });
});

describe('shapes that must keep failing closed', () => {
  it('still reports a pipe held in a variable as unvalidated', () => {
    // A false positive, deliberately: it breaks the build on a route that is
    // in fact validated, which is the safe direction to be wrong in.
    expect(
      only(`
      @Controller('feedback')
      export class FeedbackController {
        @Post()
        create(@Body(bodyPipe) dto: unknown) {}
      }
    `).bindings,
    ).toEqual([{ kind: 'Body', validated: false }]);
  });

  it('still reports a bare @Body under @UsePipes as unvalidated', () => {
    expect(
      only(`
      @Controller('feedback')
      export class FeedbackController {
        @UsePipes(new ZodValidationPipe(createFeedbackSchema))
        @Post()
        create(@Body() dto: unknown) {}
      }
    `).bindings,
    ).toEqual([{ kind: 'Body', validated: false }]);
  });
});

describe('things that are not routes', () => {
  it('ignores a class that is not a controller', () => {
    expect(
      scan(
        `
        @Injectable()
        export class GradeService {
          notARoute() {}
        }
      `,
        `import { Injectable } from '@nestjs/common';
`,
      ).routes,
    ).toEqual([]);
  });

  it('ignores a controller method with no route decorator', () => {
    expect(
      scan(`
        @Controller('grade')
        export class GradeController {
          private helper() {}
        }
      `).routes,
    ).toEqual([]);
  });
});
