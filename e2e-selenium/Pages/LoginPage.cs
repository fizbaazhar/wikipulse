using OpenQA.Selenium;

namespace WikiPulse.E2E.Pages;

/// <summary>The sign-in form. Fields are found by their id, buttons by their visible text.</summary>
public class LoginPage(IWebDriver driver, BrowserTest test)
{
    private IWebElement Username => driver.FindElement(By.Id("login-username"));
    private IWebElement Password => driver.FindElement(By.Id("login-password"));
    private IWebElement SignInButton => driver.FindElement(By.XPath("//button[normalize-space()='Sign in']"));

    public string Heading => driver.FindElement(By.Id("login-title")).Text;

    /// <summary>The form's error message.</summary>
    public string Error => test.Until(d => d.FindElement(By.CssSelector(".login-card [role='alert']")), "the login error").Text;

    public DashboardPage SignIn(string user, string password)
    {
        TrySignIn(user, password);
        test.Until(d => new Uri(d.Url).AbsolutePath == "/dashboard", "the dashboard to open");
        return new DashboardPage(driver, test);
    }

    /// <summary>Submit the form without expecting it to succeed.</summary>
    public void TrySignIn(string user, string password)
    {
        test.Until(d => d.FindElement(By.Id("login-username")).Displayed, "the login form");
        Username.Clear();
        Username.SendKeys(user);
        Password.Clear();
        Password.SendKeys(password);
        SignInButton.Click();
    }
}
