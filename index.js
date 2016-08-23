#!/usr/bin/env node

"use strict";
const async = require("marcosc-async");
const fs = require("fs-promise");
const git = require("./git");
const path = require("path");
const program = require("commander");
const prompt = require("prompt");
const tmplDir = __dirname + "/templates/";
const { version } = require("./package.json");
const messages = require("./messages");

// Configure prompt
prompt.message = " 👉 ";
prompt.delimiter = "";

// Colors
const { g, gr, r, y, heading } = require("./theme.js");

// Utility function to convert first letter to uppercase.
function upperCaseFirstLetter(word) {
  if (typeof word !== "string") {
    throw new TypeError("Expected string");
  }
  if (!word) {
    return word;
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// User prompt tasks
const Prompts = {
  askQuestion(promptOps) {
    return new Promise((resolve, reject) => {
      prompt.get(promptOps, (err, res) => {
        if (err) {
          return reject(new Error(" 🙅 User canceled."));
        }
        resolve(res.question);
      });
    });
  },
  askRepoName() {
    const promptOps = {
      description: "Name of Git repository:",
      default: path.basename(process.cwd()),
    };
    return this.askQuestion(promptOps);
  },
  askProjectName(repo) {
    const promptOps = {
      description: "Name of project:",
      default: `The ${upperCaseFirstLetter(repo)} API`,
    };
    return this.askQuestion(promptOps);
  },
  askUserName() {
    return async.task(function*() {
      const user = yield git.getConfigData("config user.name");
      const promptOps = {
        description: "Primary Editor of the spec:",
        default: user.trim(),
      };
      return yield this.askQuestion(promptOps);
    }, this);
  },
  askAffiliation(hint = "") {
    return async.task(function*() {
      const promptOps = {
        description: `Company affiliation(e.g., ${upperCaseFirstLetter(hint) || "Monsters"} Inc.):`,
        default: upperCaseFirstLetter(hint),
      };
      return yield this.askQuestion(promptOps);
    }, this);
  },
  askAffiliationURL(emailHint = "") {
    const [, hint] = emailHint.match(/(?:@)(.+)/);
    return async.task(function*() {
      const promptOps = {
        description: "Company URL:",
      };
      if (hint) {
        promptOps.default = `https://${hint}`;
      }
      return yield this.askQuestion(promptOps);
    }, this);
  },
  askEmail() {
    return async.task(function*() {
      const email = yield git.getConfigData("config user.email");
      const promptOps = {
        description: "Email (optional):",
        default: email.trim(),
      };
      return yield this.askQuestion(promptOps);
    }, this);
  },
  askWhichGitBranch() {
    return async.task(function*() {
      const promptOps = {
        description: "Main git branch for the spec:",
        default: "gh-pages",
      };
      return yield this.askQuestion(promptOps);
    }, this);
  }
};

const Tasks = {
  performGitTasks(collectedData) {
    console.info(heading("Performing git tasks"));
    return async.task(function*() {
      if (collectedData.needsGitInit) {
        const result = yield git("init");
        console.info(g(` ✅ ${result.trim()}`));
      }
      yield git.switchBranch(collectedData.mainBranch);
      console.info(g(` ✅ switched to branch ${collectedData.mainBranch}`));
      return collectedData;
    }, this);
  },
  populateTemplate(rawData, collectedData, file) {
    // find all {{\w}} and replace them form collectedData
    const replaceSet = (rawData.match(/{{\w+}}/gm) || [])
      .map(match => match.replace(/[{{|}}]/g, ""))
      .reduce((collector, match) => collector.add(match), new Set());
    return Array
      .from(replaceSet)
      .map(match => {
        const key = new RegExp(`{{${match}}}`, "gm");
        if (!collectedData[match]) {
          console.warn(`${y("Warning")}: no match for \`${match}\` in template ${file}`);
        }
        const value = collectedData[match] || match;
        return [key, value];
      })
      .reduce((rawData, [key, value]) => rawData.replace(key, value), rawData);
  },
  // Uses git to get the name of the repo (cwd)
  writeTemplates(collectedData) {
    console.info(heading("Creating Templates"));
    return async.task(function*() {
      const dirFiles = yield fs.readdir(tmplDir);
      const destinations = dirFiles.map(
        filename => ([tmplDir + filename, `${process.cwd()}/${filename}`])
      );
      const successFiles = [];
      for (let [from, to] of destinations) {
        const exists = yield fs.exists(to);
        if (exists) {
          console.warn(`${y(" ⚠️ Skipping")} ${gr(path.basename(to))} (already exists)`);
          continue;
        }
        const rawData = yield fs.readFile(from, "utf8");
        const data = this.populateTemplate(rawData, collectedData, path.basename(from));
        try {
          yield fs.writeFile(to, data);
          const basename = path.basename(to);
          console.log(`${g(" ✅ Created")} ${gr(basename)}`);
          successFiles.push(basename);
        } catch (err) {
          console.error(`${r(" => Error! ")} could not create ${gr(path.basename(to))}`);
        }
      }
      if (successFiles.length) {
        yield git(`add ${successFiles.join(" ")}`);
        yield git(`commit -am "feat: add WICG files."`);
        console.info(g(`\nCommitted changes to "${collectedData.mainBranch}" branch.`));
      }
      return collectedData;
    }, this);
  },
  // Tell the user what they should do next.
  postInitialization() {
    return async.task(function*() {
      console.info(messages.finished);
    }, this);
  },
  collectProjectData(name = "") {
    console.info(heading("About this WICG project"));
    return async.task(function*() {
      let repo = "";
      let needsGitInit = true;
      try {
        repo = yield git.getRepoName();
        needsGitInit = false;
      } catch (err) {
        const response = yield Prompts.askRepoName();
        repo = response.trim();
      }
      // Let's get the name of the project
      if (!name) {
        name = yield Prompts.askProjectName(repo);
      }
      // Derive the user's name from git config
      const userName = yield Prompts.askUserName();
      const userEmail = yield Prompts.askEmail();
      // Get the company from the email
      const [, affiliationHint] = /(?:@)([\w|-]+)/.exec(userEmail);
      const affiliation = yield Prompts.askAffiliation(affiliationHint);
      let affiliationURL = "";
      if (affiliation) {
        affiliationURL = yield Prompts.askAffiliationURL(userEmail);
      }
      const mainBranch = yield Prompts.askWhichGitBranch();
      return {
        affiliation,
        affiliationURL,
        mainBranch,
        name,
        needsGitInit,
        repo,
        userEmail,
        userName,
      };
    });
  },
};

program
  .version(version)
  .command("init [name]")
  .description("start a new incubation project")
  .action((name, options) => {
    console.info(messages.logo);
    Tasks.collectProjectData(name, options)
      .then(Tasks.performGitTasks.bind(Tasks))
      .then(Tasks.writeTemplates.bind(Tasks))
      .then(Tasks.postInitialization.bind(Tasks))
      .catch(err => console.error(`\n${r(err.stack)}`));
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
  console.log(messages.example);
}
