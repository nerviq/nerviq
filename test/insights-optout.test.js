/**
 * Insights opt-in/opt-out precedence.
 *
 * Regression guard for v1.31.0: the module header documented
 * --no-insights / NERVIQ_NO_INSIGHTS=1 opt-outs that were never
 * implemented. They now exist and must always win over any opt-in.
 */

const { shouldCollect } = require('../src/insights');

describe('insights shouldCollect', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.argv = originalArgv;
    delete process.env.NERVIQ_INSIGHTS;
    delete process.env.NERVIQ_NO_INSIGHTS;
    Object.assign(process.env, originalEnv);
  });

  test('test_should_not_collect_when_nothing_is_set', () => {
    // Arrange
    process.argv = ['node', 'cli.js', 'audit'];

    // Act + Assert
    expect(shouldCollect()).toBe(false);
  });

  test('test_should_collect_when_insights_flag_passed', () => {
    // Arrange
    process.argv = ['node', 'cli.js', 'audit', '--insights'];

    // Act + Assert
    expect(shouldCollect()).toBe(true);
  });

  test('test_should_not_collect_when_no_insights_flag_overrides_env_optin', () => {
    // Arrange
    process.env.NERVIQ_INSIGHTS = '1';
    process.argv = ['node', 'cli.js', 'audit', '--no-insights'];

    // Act + Assert
    expect(shouldCollect()).toBe(false);
  });

  test('test_should_not_collect_when_no_insights_env_overrides_flag_optin', () => {
    // Arrange
    process.env.NERVIQ_NO_INSIGHTS = '1';
    process.argv = ['node', 'cli.js', 'audit', '--insights'];

    // Act + Assert
    expect(shouldCollect()).toBe(false);
  });
});
