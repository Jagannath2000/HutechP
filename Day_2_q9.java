import java.util.Scanner;

public class Day_2_q9 {
    //Valid Parentheses
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Enter a string : ");

        String st = sc.nextLine();

        if(validBracket(st))
        System.out.println("You enter valid brakets ");
        else
        System.out.println("You did not enter valid brackets ");


    }

    private static boolean validBracket(String st) {
        char []a1 = new char[3];
        int a=0,b=0;
        char []a2 = new char[3];

        for(int i=0;i<st.length();i++){
            if(st.charAt(i)=='[' || st.charAt(i)=='{' || st.charAt(i)=='(' ){
                a1[a]=st.charAt(i) ;
                a++;

            }
             if(st.charAt(i)==']' || st.charAt(i)=='}' || st.charAt(i)==')' ){
                a2[b]=st.charAt(i) ;
                b++;

            }

        }

        for(int i=0;i<3;i++){
            if (a1[i] != '\0' && a2[i] != '\0'  )
            return true;
        }
        

        return false;
    }
    
}
