using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using OpenQA.Selenium.Support.UI;
using WikiPulse.E2E.Pages;

namespace WikiPulse.E2E;

/// <summary>
/// Base class for every test: a fresh Chrome per test (headless unless HEADED=1),
/// short explicit waits instead of sleeps, and a check that nothing called alert()
/// (that would mean an XSS payload from the stream ran).
/// </summary>
public abstract class BrowserTest
{
    /// <summary>The dashboard. `npm run e2e:selenium` starts it on port 5174.</summary>
    public static readonly string BaseUrl =
        (Environment.GetEnvironmentVariable("WIKIPULSE_E2E_URL") ?? "http://localhost:5174").TrimEnd('/');

    // The throwaway account the e2e back end starts with (see frontend/package.json).
    public const string User = "e2e";
    public const string Password = "e2e-password";

    protected IWebDriver Driver = null!;

    [SetUp]
    public void StartBrowser()
    {
        var options = new ChromeOptions();
        if (Environment.GetEnvironmentVariable("HEADED") != "1")
        {
            options.AddArgument("--headless=new");
        }
        options.AddArgument("--window-size=1440,1000");
        // Selenium Manager finds or downloads a matching chromedriver.
        Driver = new ChromeDriver(options);
        Driver.Manage().Timeouts().ImplicitWait = TimeSpan.Zero; // explicit waits only
    }

    [TearDown]
    public void StopBrowser()
    {
        try
        {
            var alert = Driver.SwitchTo().Alert();
            var text = alert.Text;
            alert.Dismiss();
            Assert.Fail($"Unexpected alert: {text}");
        }
        catch (NoAlertPresentException)
        {
            // Expected: nothing on the page called alert().
        }
        finally
        {
            Driver.Quit();
            Driver.Dispose();
        }
    }

    /// <summary>Wait up to 10 s for a condition, then fail with a readable message.</summary>
    protected T WaitFor<T>(Func<IWebDriver, T> condition, string what)
    {
        var wait = new WebDriverWait(Driver, TimeSpan.FromSeconds(10));
        wait.IgnoreExceptionTypes(typeof(NoSuchElementException), typeof(StaleElementReferenceException));
        wait.Message = $"Timed out waiting for: {what}";
        return wait.Until(condition);
    }

    /// <summary>Open the login page with the guided tour marked as seen, so it doesn't cover the page.</summary>
    protected LoginPage OpenLogin()
    {
        Driver.Navigate().GoToUrl($"{BaseUrl}/login");
        ((IJavaScriptExecutor)Driver).ExecuteScript("localStorage.setItem('wikipulse-tour-done-v1', '1');");
        Driver.Navigate().Refresh();
        return new LoginPage(Driver, this);
    }

    /// <summary>Signed in, with the recorded sample on screen.</summary>
    protected DashboardPage OpenDashboard()
    {
        var dashboard = OpenLogin().SignIn(User, Password);
        dashboard.WaitUntilLoaded();
        return dashboard;
    }

    internal T Until<T>(Func<IWebDriver, T> condition, string what) => WaitFor(condition, what);
}
