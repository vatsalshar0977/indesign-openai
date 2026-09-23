# OpenAI for Adobe InDesign

UXP dialog to connect OpenAI with Adobe InDesign (2023/v18.5). UXP Plugin (Text/GPT-4o, Image description/GPT-4o). 

<img width="1920" alt="openAI_for_indesign" src="https://github.com/RolandDreger/indesign-openai/assets/19747449/27885cdb-2254-4527-8b78-3672d27a09e6">


## Arena bridge — agent-driven, no ChatGPT in the loop

This fork replaces the OpenAI dependency with a bridge: an agent answers the requests and
drives InDesign directly.

- **No OpenAI account, no API key, no model picker.** The panel boots straight into
  *Arena agent* mode; the key field and the model sliders are hidden.
- **Ask, or let the agent act.** Type an instruction and press Send — the request is
  answered by the agent. The agent link (on by default) also lets the agent read the
  selection, rewrite it, inspect the document and export files.

```bash
npm run bridge     # start the server, then open the dashboard it prints
npm test           # round-trip check with mocked InDesign
```

Setup, command reference and API: **[docs/BRIDGE.md](docs/BRIDGE.md)**.
Trouble installing the plugin (unsigned `.ccx`), or want the bridge on your own machine?
**[docs/INSTALL.md](docs/INSTALL.md)** — Windows walkthrough:
**[docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md)**.
OpenAI models can still be switched back on (see §5 of the doc).

## Usage

1. Go to `Code` → `Download ZIP`
2. Create an account at [OpenAi](https://openai.com/) (if you don't already have one).
3. Create an API key under `User` → `API keys` and the button `Create new secret key`. 

**Plugin** (latest)

4. To install the plugin, double-click the downloaded file `openai-4-indesign.ccx`.
5. At the first start click on the key icon (top right of the panel) and enter the API key in the input field of the opened dialog. 

## Use Cases
Here are some use cases: [Translation, Text Shortening, Headline Creation](https://vimeo.com/836122207), [Images](https://vimeo.com/835233091), [Table editing](https://vimeo.com/869998618) or [image description](https://vimeo.com/895310245). And GREP expressions are also a good use case.

You have others, please let me know ...

## Note

There is a paid plugin specifically for generating alternate text, [ALT-Text-4-InDesign](https://exchange.adobe.com/apps/cc/1c6b7a83/alt-text-for-indesign), which was developed based on this plugin.

## Remark
I think many things about *»Artificial Intelligence«* are currently rightly criticized, such as high energy consumption, unclear copyright, discrimination by algorithms, dubious origin of the training data and also poor working conditions and payment of those who classified them. 

Nevertheless, AI has come to stay and offers many interesting new possibilities. Ultimately, everyone has to decide for themselves whether to use it or not. 

# Support
If you want to support the development of the script: 

[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=roland%2edreger%40a1%2enet&lc=AT&item_name=Roland%20Dreger%20%2f%20Donation%20for%20script%20development%20openai-4-indesign&currency_code=EUR&bn=PP%2dDonationsBF%3abtn_donateCC_LG%2egif%3aNonHosted)

# License

[MIT](http://www.opensource.org/licenses/mit-license.php)


