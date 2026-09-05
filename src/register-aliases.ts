import { join } from 'node:path';
import { register } from 'tsconfig-paths';

register({
  baseUrl: join(__dirname),
  paths: {
    '@/*': ['*'],
  },
});
