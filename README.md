Tennis round robin tournament generator, hosted by Firebase.

## Where the code lives

Most of the code is in src/app/page.js

The page title and description (window/tab title) is in src/app/layout.js and can be changed there.

The icon used next to the window/tab title is inside the public/ directory. If you want to change it, put a new image inside of public/, and set the `icons` value in src/app/layout.js to match the image filename.


## How to develop

You can make changes and test inside the browser by:

1. Opening the command prompt
2. Enter `cd steinman-tennis` to go inside the project directory
3. Enter `npm install` and press return
3. Enter `npm run dev` and press return
4. Open your browser and go to [http://localhost:3000](http://localhost:3000)

Now if you make any changes to the code, you should be able to see what the result is in the browser.


## How to deploy

For the first time, you'll have to install Firebase tools. Open your command prompt and run:

```
npm install -g firebase-tools
```

Then login to Firebase with:

```
firebase login
```

From then on, you should be able to skip those steps.

When you're ready to deploy, you can create a build for the project that can be deployed by running:

```
npm run build
```

Then you should be able to deploy the changes with:

```
firebase deploy --only hosting
```

## Making more changes with Gemini

You can keep working on changing the app with Gemini using the contents in src/app/page.js.

Unfortunately, there's some incompatibility between what the real website expects and what Gemini's canvas expects. We need real Firebase variables for the website to run, but Gemini is using fake ones in the background, and the real ones seem to really be confusing it.

Don't be too worried if Gemini says "Something went wrong" -  everything seems to be running just fine despite that message.

It may also be a good idea to directly tell Gemini in your message something like "Do not touch the Firebase or Gemini API key variables." I noticed that Gemini seems to like to remove the real variables, especially `geminiApiKey`. If they are removed, then clicking on the buttons in the website will throw an error. The AI buttons will not work if it removes the `geminiApiKey`.

I put the code that initializes the important variables in `src/app/analytics-variables.js` as a backup. You can paste it back in if Gemini removes it. The values are also stored in `.env.local`.


## Testing

After Gemini makes changes

- Test that the buttons do not throw an error
- Test that the AI buttons do not throw an error and show AI responses properly formatted
- Test score entry
