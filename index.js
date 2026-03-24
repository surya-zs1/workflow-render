require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const axios = require('axios');

// 1. Database Setup
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB Connection Error:", err));

const RepoSchema = new mongoose.Schema({
  userId: Number,
  label: String,
  owner: String,
  repo: String,
  pat: String,
  workflowId: { type: String, default: 'main.yml' }
});
const Repo = mongoose.model('Repo', RepoSchema);

// 2. Bot & Scene Setup (for the multi-step "Add Repo" flow)
const bot = new Telegraf(process.env.BOT_TOKEN);

const addRepoWizard = new Scenes.WizardScene(
  'ADD_REPO_SCENE',
  (ctx) => {
    ctx.reply('Step 1: Enter a friendly name for this setup (e.g., "My Web App"):');
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.label = ctx.message.text;
    ctx.reply('Step 2: Enter the GitHub Repo in "owner/repo" format (e.g., "cyber/my-project"):');
    return ctx.wizard.next();
  },
  (ctx) => {
    const parts = ctx.message.text.split('/');
    if (parts.length !== 2) return ctx.reply('Invalid format. Use owner/repo.');
    ctx.wizard.state.owner = parts[0];
    ctx.wizard.state.repo = parts[1];
    ctx.reply('Step 3: Paste your GitHub Personal Access Token (PAT):');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const newRepo = new Repo({
      userId: ctx.from.id,
      label: ctx.wizard.state.label,
      owner: ctx.wizard.state.owner,
      repo: ctx.wizard.state.repo,
      pat: ctx.message.text
    });
    await newRepo.save();
    ctx.reply('✅ Saved successfully!', mainMenu());
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage([addRepoWizard]);
bot.use(session());
bot.use(stage.middleware());

// 3. Keyboards
const mainMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback('➕ Add New Repo/PAT', 'btn_add')],
  [Markup.button.callback('📋 List My Repos', 'btn_list')],
]);

// 4. Bot Commands & Actions
bot.start((ctx) => ctx.reply('Welcome, Chief. Manage your workflows below:', mainMenu()));

bot.action('btn_add', (ctx) => ctx.scene.enter('ADD_REPO_SCENE'));

bot.action('btn_list', async (ctx) => {
  const repos = await Repo.find({ userId: ctx.from.id });
  if (repos.length === 0) return ctx.reply('No repos found.', mainMenu());

  const buttons = repos.map(r => [
    Markup.button.callback(`🚀 Run: ${r.label}`, `run_${r._id}`),
    Markup.button.callback(`🗑 Delete`, `del_${r._id}`)
  ]);
  ctx.reply('Your Repositories:', Markup.inlineKeyboard(buttons));
});

// Trigger Workflow
bot.action(/run_(.+)/, async (ctx) => {
  const repo = await Repo.findById(ctx.match[1]);
  try {
    await axios.post(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/workflows/${repo.workflowId}/dispatches`,
      { ref: 'main' },
      { headers: { Authorization: `token ${repo.pat}`, Accept: 'application/vnd.github+json' } }
    );
    ctx.answerCbQuery(`✅ Workflow ${repo.label} started!`);
  } catch (err) {
    ctx.answerCbQuery(`❌ Error: ${err.response?.status || 'Failed'}`);
  }
});

// Delete Repo
bot.action(/del_(.+)/, async (ctx) => {
  await Repo.findByIdAndDelete(ctx.match[1]);
  ctx.reply('🗑 Repo removed.');
  ctx.answerCbQuery();
});

// 5. Render Keep-Alive (Health Check)
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is Running!'));
app.listen(process.env.PORT || 3000);

bot.launch();
