const fs = require('fs');

const old = JSON.parse(fs.readFileSync('logs/outreach_state_backup.json', 'utf8'));
const users = {};

for (const [key, val] of Object.entries(old.messaged || {})) {
  const followedUp = (old.followed_up || {})[key];
  const replied    = (old.replied     || {})[key];

  users[key] = {
    username:              val.username || key,
    step1_sent:            true,
    step1_sent_at:         val.sentAt || new Date().toISOString(),
    step1_template:        val.templateId || '',
    step2_sent:            followedUp ? true : false,
    step2_sent_at:         followedUp ? followedUp.at : null,
    step2_value_template:  followedUp ? followedUp.valueTpl : null,
    step2_link_template:   followedUp ? followedUp.linkTpl  : null,
    replied:               replied ? true : false,
    closed:                val.blocked ? true : false,
    closed_reason:         val.blocked ? 'blocked_or_banned' : null,
    processed_message_ids: [],
    trigger:               val.trigger   || '',
    leadType:              val.leadType  || '',
    url:                   val.url       || '',
    subreddit:             val.subreddit || '',
    last_message_at:       val.sentAt    || new Date().toISOString()
  };
}

fs.writeFileSync('logs/contacted_users.json', JSON.stringify(users, null, 2));
console.log('Migrated', Object.keys(users).length, 'users to contacted_users.json');
