const aiTools = [
  'aider',
  'amp',
  'anthropic',
  'chatgpt',
  'claude',
  'codex',
  'copilot',
  'cursor',
  'devin',
  'gemini',
  'jules',
  'openai',
  'opencode',
  'qwen',
  'windsurf',
].join('|');

// Unicode-aware word boundaries, so "Ampère" or "OpenCoder" don't match.
const tool = `(?<![\\p{L}\\p{N}])(?:${aiTools})(?![\\p{L}\\p{N}])`;

const forbiddenPatterns = [
  // Any co-author, human or not.
  /^Co-authored-by:.*/im,
  // Made-with: Cursor, Assisted-by: Claude:claude-opus-5-5, ...
  new RegExp(`^(?:Assisted-by|Generated-by|Made-with|Signed-off-by):.*${tool}`, 'imu'),
  // Tool-specific trailers: Copilot-Session: ..., Amp-Thread: ...
  new RegExp(`^${tool}-[\\w-]+:`, 'imu'),
  // 🤖 Generated with [Claude Code](https://claude.com/claude-code)
  new RegExp(`(?:Generated|Made) (?:with|by|using)\\b.*${tool}`, 'iu'),
];

const ticketIdInHeader = /\bTT-\d+\b/;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-generated': parsed => {
          for (const pattern of forbiddenPatterns) {
            const match = parsed.raw.match(pattern);
            if (match) {
              return [false, `Commit message contains forbidden AI-generated content: "${match[0]}"`];
            }
          }

          return [true, ''];
        },
        'no-ticket-id-in-header': parsed => {
          const match = (parsed.header ?? '').match(ticketIdInHeader);
          if (match) {
            return [
              false,
              `Commit header contains ticket ID "${match[0]}". Move it to a "Refs: ${match[0]}" trailer in the body.`,
            ];
          }

          return [true, ''];
        },
      },
    },
  ],
  rules: {
    // Ensure the commit type is lowercase
    'type-case': [2, 'always', 'lower-case'],
    // Ensure the commit type is not empty
    'type-empty': [2, 'never'],
    // Ensure the commit subject is not empty
    'subject-empty': [2, 'never'],
    // Ensure the commit subject doesn't end with a period
    'subject-full-stop': [2, 'never', '.'],
    // Limit the subject line to 72 characters
    'subject-max-length': [2, 'always', 72],
    // Ensure the commit body has a maximum line length
    'body-max-line-length': [2, 'always', 100],
    // Ensure the commit footer has a maximum line length
    'footer-max-line-length': [2, 'always', 100],
    // Ensure valid commit types
    'type-enum': [
      2,
      'always',
      [
        'feat', // A new feature
        'fix', // A bug fix
        'docs', // Documentation only changes
        'style', // Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
        'refactor', // A code change that neither fixes a bug nor adds a feature
        'perf', // A code change that improves performance
        'test', // Adding missing tests or correcting existing tests
        'build', // Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)
        'ci', // Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs)
        'chore', // Other changes that don't modify src or test files
        'revert', // Reverts a previous commit
      ],
    ],
    // Custom rule to block AI-generated strings
    'no-ai-generated': [2, 'always'],
    // Custom rule to keep internal ticket IDs out of release notes and the CHANGELOG
    'no-ticket-id-in-header': [2, 'always'],
  },
  helpUrl: 'https://github.com/conventional-changelog/commitlint/#what-is-commitlint',
};
