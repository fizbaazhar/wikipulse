using OpenQA.Selenium;

namespace WikiPulse.E2E.Pages;

/// <summary>The dashboard: header, panels and the AI assistant.</summary>
public class DashboardPage(IWebDriver driver, BrowserTest test)
{
    private static By Button(string name) =>
        By.XPath($"//button[normalize-space()='{name}' or @aria-label='{name}']");

    public void WaitUntilLoaded() =>
        test.Until(d => d.FindElements(By.CssSelector(".feed-item")).Count > 0, "the first edits in the feed");

    // ---------------------------------------------------------------- header
    public string ConnectionStatus => driver.FindElement(By.CssSelector("header [role='status']")).Text;

    public IReadOnlyList<string> KpiLabels =>
        driver.FindElements(By.CssSelector("[aria-label='Key numbers'] .kpi-label")).Select(e => e.Text).ToList();

    private IWebElement WikiFilter => driver.FindElement(By.CssSelector("select[aria-label='Filter by wiki']"));

    public string SelectedWiki => WikiFilter.GetAttribute("value") ?? "";

    /// <summary>Pick a wiki in the header filter; an empty id means "All wikis".</summary>
    public void FilterByWiki(string wikiId)
    {
        WikiFilter.Click();
        WikiFilter.FindElement(By.CssSelector($"option[value='{wikiId}']")).Click();
    }

    public void SignOut()
    {
        driver.FindElement(By.CssSelector("button[aria-label^='Account:']")).Click();
        test.Until(d => d.FindElement(Button("Sign out")), "the Sign out button").Click();
        test.Until(d => new Uri(d.Url).AbsolutePath == "/login", "the login page");
    }

    // -------------------------------------------------------- top pages, feed
    public IReadOnlyList<IWebElement> TopPages => driver.FindElements(By.CssSelector(".top-pages .top-item"));

    public IReadOnlyList<int> TopCounts =>
        driver.FindElements(By.CssSelector(".top-pages .top-count")).Select(e => int.Parse(e.Text)).ToList();

    public HashSet<string> FeedWikis =>
        driver.FindElements(By.CssSelector(".feed-item")).Select(e => e.GetAttribute("data-wiki") ?? "").ToHashSet();

    public bool FeedIsPaused => driver.FindElements(Button("Go live")).Count > 0;

    public void GoLive() => driver.FindElement(Button("Go live")).Click();

    public void Pause() => driver.FindElement(Button("Pause")).Click();

    // --------------------------------------------------------- vandalism panel
    public string FlaggedPanelText => driver.FindElement(By.CssSelector(".flagged")).Text;

    public int InjectedImages => driver.FindElements(By.CssSelector("img[src='x']")).Count;

    // -------------------------------------------------------------- assistant
    public void OpenAssistant()
    {
        driver.FindElement(Button("Ask the AI assistant")).Click();
        test.Until(d => d.FindElement(By.CssSelector("[role='dialog'][aria-label='AI assistant']")).Displayed, "the assistant");
    }

    public void Ask(string question)
    {
        var box = driver.FindElement(By.Id("assistant-question"));
        box.SendKeys(question);
        box.SendKeys(Keys.Enter);
    }

    public void ClickSuggestion(string text) =>
        driver.FindElement(By.XPath($"//button[contains(@class,'assistant-chip') and normalize-space()='{text}']")).Click();

    public IReadOnlyList<string> Questions =>
        driver.FindElements(By.CssSelector(".assistant-msg-user")).Select(e => e.Text).ToList();

    /// <summary>
    /// The latest answer, once it is complete: answers appear word by word, so
    /// wait until the text stops changing between two polls.
    /// </summary>
    public string LastAnswer()
    {
        string? previous = null;
        return test.Until(d =>
        {
            if (d.FindElements(By.CssSelector(".assistant-typing")).Count > 0) return null;
            var answers = d.FindElements(By.CssSelector(".assistant-msg-assistant"));
            var text = answers.Count > 0 ? answers[^1].Text : "";
            if (string.IsNullOrWhiteSpace(text) || text != previous)
            {
                previous = text;
                return null;
            }
            return text;
        }, "a complete answer from the assistant")!;
    }

    public int ImagesInAssistant => driver.FindElements(By.CssSelector(".assistant img")).Count;
}
