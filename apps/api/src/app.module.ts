import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ORPCModule } from '@orpc/nest';
import { AuthModule } from './auth/auth.module.js';
import { sanitizeError } from './common/sanitize-error.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { OpenApiModule } from './openapi/openapi.module.js';
import { StoresModule } from './stores/stores.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Repo-root .env (optional). Real environment variables always take precedence.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    // Shape every handler failure before it reaches the client: deliberate ORPCErrors keep their
    // Thai message, anything else becomes a generic Thai internal error (no stack, no DB detail; NFR-04).
    ORPCModule.forRoot({
      interceptors: [
        async ({ next }) => {
          try {
            return await next();
          } catch (error) {
            throw sanitizeError(error);
          }
        },
      ],
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    OpenApiModule,
    StoresModule,
    SuppliersModule,
  ],
})
export class AppModule {}
