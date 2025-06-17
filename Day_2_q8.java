package Hutech;

import java.util.Scanner;

public class Day_2_q8 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Enter a string : ");
        String st =sc.nextLine();

        System.out.println("After reverse the string was "+ reverseString(st) );
    
    }

    private static String reverseString(String st) {

        String res= "";

        for(int i=0;i< st.length();i++){
            res=st.charAt(i)+res;
        }
      

        return res;
    }
    
}
